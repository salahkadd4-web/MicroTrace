"""Reader for the 'Raman database of microplastics weathered under natural environments'."""
from __future__ import annotations

import re
import warnings
from collections.abc import Iterator
from pathlib import Path

import openpyxl

from microtrace_core.polymers import normalize_polymer
from microtrace_core.readers.common import read_spectrum_xy, rel_posix
from microtrace_core.spectrum import Spectrum

FOLDER = "A Raman database of microplastics weathered under natural environments"
_ID = re.compile(r"^(sta|wea)-\d+$")


def _cell(value: object) -> str:
    return "" if value is None else str(value).strip()


def _load_labels(xlsx: Path) -> dict[str, tuple[str, str]]:
    labels: dict[str, tuple[str, str]] = {}
    if not xlsx.is_file():
        raise FileNotFoundError(f"content.xlsx not found: {xlsx}")
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    try:
        ws = wb["content"] if "content" in wb.sheetnames else wb.worksheets[0]
        for row in ws.iter_rows(values_only=True):
            row = tuple(row) + (None,) * (6 - len(row))
            key = _cell(row[0])
            if _ID.match(key):
                if key in labels:
                    raise ValueError(f"{xlsx}: duplicate ID {key!r}")
                labels[key] = (_cell(row[1]), _cell(row[5]))
    finally:
        wb.close()
    return labels


def read_weathered(root: Path) -> Iterator[Spectrum]:
    base = root / "Spectres" / FOLDER
    if not base.is_dir():
        raise FileNotFoundError(f"weathered Raman folder not found: {base}")
    labels = _load_labels(base / "content.xlsx")
    for path in sorted(p for p in base.iterdir() if p.is_file() and p.suffix.lower() == ".txt"):
        if not _ID.match(path.stem):
            warnings.warn(f"skipping unexpected file {path}", stacklevel=2)
            continue
        x, y = read_spectrum_xy(path, None)
        raw, note = labels.get(path.stem, ("", ""))
        sid = f"raman_weathered:{path.stem}"
        yield Spectrum(
            spectrum_id=sid, source="raman_weathered", technique="raman", x=x, y=y,
            x_unit="cm-1", polymer=normalize_polymer(raw), polymer_raw=raw,
            state="pristine" if path.stem.startswith("sta-") else "weathered",
            sample_group=sid, file=rel_posix(path, root), label_note=note,
        )
