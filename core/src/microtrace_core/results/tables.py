"""Reading of CSV and XLSX result tables into raw text tables."""
from __future__ import annotations

import csv
import io
import math
import zipfile
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import PurePath

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

_TEXT_EXT = {".csv", ".tsv", ".txt"}
_DELIMITERS = (";", ",", "\t")

MAX_BYTES = 50 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
MAX_COLUMNS = 500
MAX_ROWS = 100_000
MAX_BLANK_ROWS = 10_000
MAX_CELLS = 2_000_000  # data rows x columns


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


def _float_text(v: float) -> str:
    """Shortest exact decimal of a float (its repr) without exponent when 1e-12 <= |v| < 1e21
    (1e-05 -> "0.00001", 2.0 -> "2"); outside that range the short repr ("1e+308") is kept,
    so a cell never expands into hundreds of digits (censoring reads exponents)."""
    if not math.isfinite(v) or (v != 0 and not 1e-12 <= abs(v) < 1e21):
        return repr(v)
    text = format(Decimal(repr(v)), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


def _cell_text(v: object) -> str:
    """Faithful text of a typed spreadsheet cell."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return _float_text(v)
    if isinstance(v, datetime):
        return v.date().isoformat() if v.time() == time(0) else v.isoformat(timespec="seconds")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, time):
        return v.isoformat(timespec="seconds")
    return _clean(str(v))


def _decode(data: bytes) -> str:
    try:
        if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
            return data.decode("utf-16")
        try:
            return data.decode("utf-8-sig")
        except UnicodeDecodeError:
            return data.decode("cp1252")
    except UnicodeDecodeError as exc:
        raise TableReadError(
            "Encodage du fichier non reconnu (UTF-8, UTF-16 ou Windows-1252 attendus).") from exc


def _text_rows(data: bytes) -> Iterator[list[object]]:
    text = _decode(data)
    header = next((ln for ln in text.splitlines() if ln.strip()), "")
    # most frequent candidate in the header; ties resolved in _DELIMITERS order
    delim = max(_DELIMITERS, key=lambda d: (header.count(d), -_DELIMITERS.index(d)))
    try:
        yield from csv.reader(io.StringIO(text, newline=""), delimiter=delim)
    except csv.Error as exc:
        raise TableReadError(f"Fichier CSV illisible : {exc}.") from exc


def _xlsx_rows(data: bytes, sheet: str | None) -> tuple[Iterator[list[object]], str]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            total = sum(i.file_size for i in z.infolist())
    except zipfile.BadZipFile as exc:
        raise TableReadError("Fichier Excel illisible : archive .xlsx invalide.") from exc
    if total > MAX_UNCOMPRESSED_BYTES:
        raise TableReadError(
            "Fichier Excel trop volumineux une fois décompressé "
            f"(limite : {MAX_UNCOMPRESSED_BYTES // (1024 * 1024)} Mo).")
    try:
        values = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        formulas = load_workbook(io.BytesIO(data), read_only=True, data_only=False)
    except Exception as exc:
        raise TableReadError("Fichier Excel illisible ou corrompu.") from exc
    wbs = (values, formulas)
    names = values.sheetnames
    problem = None
    if sheet is None:
        if names:
            sheet = names[0]
        else:
            problem = "Le classeur Excel ne contient aucune feuille."
    elif sheet not in names:
        problem = f"Feuille « {sheet} » introuvable. Feuilles disponibles : {', '.join(names)}."
    if problem:
        for wb in wbs:
            wb.close()
        raise TableReadError(problem)

    def gen() -> Iterator[list[object]]:
        try:
            # never trust the declared <dimension>: bound the scan explicitly
            bounds = {"min_row": 1, "max_row": MAX_ROWS + MAX_BLANK_ROWS + 2,
                      "max_col": MAX_COLUMNS + 1, "values_only": True}
            pairs = zip(values[sheet].iter_rows(**bounds),
                        formulas[sheet].iter_rows(**bounds), strict=False)
            for rowno, (vals, forms) in enumerate(pairs, 1):
                for col, (v, f) in enumerate(zip(vals, forms, strict=False), 1):
                    if v is None and isinstance(f, str) and f.startswith("="):
                        raise TableReadError(
                            f"Cellule {get_column_letter(col)}{rowno} : formule sans valeur "
                            "calculée. Ouvrez le fichier dans Excel ou LibreOffice, "
                            "enregistrez-le, puis importez-le à nouveau.")
                yield list(vals)
        finally:
            for wb in wbs:
                wb.close()

    return gen(), sheet


def read_table(data: bytes, filename: str, sheet: str | None = None) -> RawTable:
    """Read a CSV/TSV/TXT/XLSX file as text cells; row numbers are the spreadsheet's."""
    ext = PurePath(filename).suffix.lower()
    if len(data) > MAX_BYTES:
        raise TableReadError(
            f"Fichier trop volumineux (limite : {MAX_BYTES // (1024 * 1024)} Mo).")
    sheet_name: str | None = None
    raw: Iterator[list[object]]
    if ext in _TEXT_EXT:
        raw = _text_rows(data)
    elif ext == ".xlsx":
        raw, sheet_name = _xlsx_rows(data, sheet)
    else:
        raise TableReadError(
            f"Format de fichier non pris en charge : « {ext or filename} ». "
            "Formats acceptés : .csv, .tsv, .txt, .xlsx.")

    columns: tuple[str, ...] | None = None
    rows: list[dict[str, str]] = []
    numbers: list[int] = []
    try:
        for rowno, rawrow in enumerate(raw, 1):
            if rowno > MAX_ROWS + MAX_BLANK_ROWS + 1:
                raise TableReadError(
                    f"Trop de lignes dans le fichier (limite : {MAX_ROWS + MAX_BLANK_ROWS} "
                    "lignes, vides comprises).")
            if len(rawrow) > MAX_COLUMNS + 1:
                if any(_cell_text(c) for c in rawrow[MAX_COLUMNS + 1:]):
                    raise TableReadError(f"Trop de colonnes (limite : {MAX_COLUMNS}).")
                rawrow = rawrow[:MAX_COLUMNS + 1]
            r = [_cell_text(c) for c in rawrow]
            if not any(r):
                continue
            if columns is None:
                while r and not r[-1]:
                    r.pop()
                if len(r) > MAX_COLUMNS:
                    raise TableReadError(f"Trop de colonnes (limite : {MAX_COLUMNS}).")
                columns = tuple(h or f"colonne_{i}" for i, h in enumerate(r, 1))
                dup = next((n for n, c in Counter(columns).items() if c > 1), None)
                if dup is not None:
                    raise TableReadError(
                        f"En-tête dupliqué : la colonne « {dup} » apparaît plusieurs fois.")
                continue
            if len(r) > len(columns):
                if any(r[len(columns):]):
                    raise TableReadError(
                        f"Ligne {rowno} : {len(r)} valeurs pour {len(columns)} colonnes "
                        "(données au-delà de l'en-tête).")
                r = r[:len(columns)]
            if len(rows) >= MAX_ROWS:
                raise TableReadError(f"Trop de lignes de données (limite : {MAX_ROWS}).")
            if (len(rows) + 1) * len(columns) > MAX_CELLS:
                raise TableReadError(
                    f"Trop de cellules dans le fichier (lignes × colonnes, limite : {MAX_CELLS}).")
            rows.append(dict(zip(columns, r + [""] * (len(columns) - len(r)), strict=True)))
            numbers.append(rowno)
    finally:
        close = getattr(raw, "close", None)
        if close:
            close()
    if columns is None:
        raise TableReadError("Le fichier est vide : aucun en-tête trouvé.")
    if not rows:
        raise TableReadError("Le fichier ne contient aucune ligne de données.")
    return RawTable(columns, tuple(rows), tuple(numbers), filename, sheet_name)
