"""Reading of CSV and XLSX result tables into raw text tables."""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime, time
from pathlib import PurePath

from openpyxl import load_workbook

_TEXT_EXT = {".csv", ".tsv", ".txt"}
_DELIMITERS = (";", ",", "\t")


class TableReadError(ValueError):
    """The uploaded file cannot be read as a table (message in French)."""


@dataclass(frozen=True)
class RawTable:
    columns: tuple[str, ...]
    rows: tuple[dict[str, str], ...]
    row_numbers: tuple[int, ...]
    source_name: str
    sheet: str | None


def _clean(text: str) -> str:
    return text.replace("\xa0", " ").strip()


def _cell_text(v: object) -> str:
    """Faithful text of a typed spreadsheet cell."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() and abs(v) < 1e15 else format(v, ".15g")
    if isinstance(v, datetime):
        return v.date().isoformat() if v.time() == time(0) else v.isoformat(timespec="seconds")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, time):
        return v.isoformat(timespec="seconds")
    return _clean(str(v))


def _decode(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def _text_rows(data: bytes) -> list[list[str]]:
    text = _decode(data)
    header = next((ln for ln in text.splitlines() if ln.strip()), "")
    # most frequent candidate in the header; ties resolved in _DELIMITERS order
    delim = max(_DELIMITERS, key=lambda d: (header.count(d), -_DELIMITERS.index(d)))
    return list(csv.reader(io.StringIO(text, newline=""), delimiter=delim))


def _xlsx_rows(data: bytes, sheet: str | None) -> tuple[list[list[object]], str]:
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:
        raise TableReadError("Fichier Excel illisible ou corrompu.") from exc
    try:
        names = wb.sheetnames
        if sheet is None:
            if not names:
                raise TableReadError("Le classeur Excel ne contient aucune feuille.")
            sheet = names[0]
        elif sheet not in names:
            raise TableReadError(
                f"Feuille « {sheet} » introuvable. Feuilles disponibles : {', '.join(names)}.")
        return [list(r) for r in wb[sheet].iter_rows(values_only=True)], sheet
    finally:
        wb.close()


def read_table(data: bytes, filename: str, sheet: str | None = None) -> RawTable:
    """Read a CSV/TSV/TXT/XLSX file as text cells; row numbers are the spreadsheet's."""
    ext = PurePath(filename).suffix.lower()
    sheet_name: str | None = None
    raw: list[list[object]]
    if ext in _TEXT_EXT:
        raw = [list(r) for r in _text_rows(data)]
    elif ext == ".xlsx":
        raw, sheet_name = _xlsx_rows(data, sheet)
    else:
        raise TableReadError(
            f"Format de fichier non pris en charge : « {ext or filename} ». "
            "Formats acceptés : .csv, .tsv, .txt, .xlsx.")

    cells = [[_cell_text(c) for c in r] for r in raw]
    start = next((i for i, r in enumerate(cells) if any(r)), None)
    if start is None:
        raise TableReadError("Le fichier est vide : aucun en-tête trouvé.")
    header = cells[start]
    while header and not header[-1]:
        header.pop()
    columns = tuple(h or f"colonne_{i}" for i, h in enumerate(header, 1))
    for name in columns:
        if columns.count(name) > 1:
            raise TableReadError(
                f"En-tête dupliqué : la colonne « {name} » apparaît plusieurs fois.")

    rows: list[dict[str, str]] = []
    numbers: list[int] = []
    for idx in range(start + 1, len(cells)):
        r = cells[idx]
        if not any(r):
            continue
        if len(r) > len(columns):
            if any(r[len(columns):]):
                raise TableReadError(
                    f"Ligne {idx + 1} : {len(r)} valeurs pour {len(columns)} colonnes "
                    "(données au-delà de l'en-tête).")
            r = r[:len(columns)]
        rows.append(dict(zip(columns, r + [""] * (len(columns) - len(r)), strict=True)))
        numbers.append(idx + 1)
    if not rows:
        raise TableReadError("Le fichier ne contient aucune ligne de données.")
    return RawTable(columns, tuple(rows), tuple(numbers), filename, sheet_name)
