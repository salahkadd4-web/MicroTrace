"""Reader for the RaSPI Raman library (ragged raw csv + metadata csv)."""
from __future__ import annotations

import csv
import re
import warnings
from collections.abc import Iterator
from pathlib import Path

import numpy as np

from microtrace_core.polymers import normalize_polymer
from microtrace_core.readers.common import rel_posix
from microtrace_core.spectrum import Spectrum


def _load_metadata(path: Path) -> dict[str, dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        return {row["Spectra ID"].strip(): row for row in csv.DictReader(fh)}


def _floats(cells: list[str], sid: str, what: str) -> np.ndarray:
    cells = [c.strip() for c in cells]
    while cells and not cells[-1]:
        cells.pop()
    try:
        return np.asarray([float(c) for c in cells], dtype=np.float64)
    except ValueError:
        raise ValueError(f"RaSPI {sid}: non-numeric or empty cell in {what} row") from None


def read_raspi(root: Path) -> Iterator[Spectrum]:
    raw = root / "Spectres" / "RaSPI_raw.csv"
    meta_path = root / "Spectres" / "RaSPI_metadata.csv"
    for p in (raw, meta_path):
        if not p.is_file():
            raise FileNotFoundError(f"RaSPI file not found: {p}")
    meta = _load_metadata(meta_path)
    with raw.open("r", encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))[1:]
    rows = [r for r in rows if any(c.strip() for c in r)]
    if len(rows) % 2:
        raise ValueError(f"{raw}: odd number of data rows, expected (id, intensity) pairs")
    for i in range(0, len(rows), 2):
        xr, yr = rows[i], rows[i + 1]
        sid = xr[0].strip()
        if len(xr) < 2 or xr[1].strip() != "wavenumber" or len(yr) < 2 \
                or yr[1].strip() != "intensity":
            raise ValueError(f"RaSPI {sid}: malformed wavenumber/intensity row pair")
        x = _floats(xr[2:], sid, "wavenumber")
        y = _floats(yr[2:], sid, "intensity")
        if len(x) != len(y):
            raise ValueError(
                f"RaSPI {sid}: wavenumber has {len(x)} values, intensity has {len(y)}")
        row = meta.get(sid)
        if row is None:
            warnings.warn(f"RaSPI spectrum {sid} has no metadata, polymer UNKNOWN",
                          stacklevel=2)
            polymer_raw, laser = "", None
        else:
            polymer_raw = (row["Plastic Type"] or "").strip()
            laser = float(row["Laser (nm)"])
        yield Spectrum(
            spectrum_id=f"raspi:{sid}", source="raspi", technique="raman", x=x, y=y,
            x_unit="cm-1", polymer=normalize_polymer(polymer_raw), polymer_raw=polymer_raw,
            state="pristine", sample_group="raspi:" + re.sub(r"[a-z]$", "", sid),
            file=rel_posix(raw, root), laser_nm=laser,
        )
