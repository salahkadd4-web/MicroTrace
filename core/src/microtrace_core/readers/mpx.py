"""Reader for the MicroPlastiX ATR-FTIR / Raman dataset (10.22000/1820)."""
from __future__ import annotations

import json
import warnings
from collections.abc import Iterator
from pathlib import Path

from microtrace_core.polymers import normalize_polymer
from microtrace_core.readers.common import read_xy, rel_posix
from microtrace_core.spectrum import MIN_POINTS, Spectrum

# Deduced from the PE peaks, see SOURCES.md.
MPX_RAMAN_LASER_NM = 532.0

_TECHNIQUE = {"ATR": "ftir_atr", "Raman": "raman"}
_STATE = {"bio": "biofouled", "nobio": "weathered"}


def _text(value: object) -> str:
    return "" if value is None else str(value)


def _read_csv(path: Path):
    """One header line, then comma-separated pairs."""
    x, y = read_xy(path, ",", skip_rows=1)
    if len(x) < MIN_POINTS:
        raise ValueError(f"{path}: only {len(x)} data points, need at least {MIN_POINTS}")
    return x, y


def read_mpx(root: Path) -> Iterator[Spectrum]:
    base = root / "Spectres" / "10.22000-1820" / "data" / "dataset"
    if not base.is_dir():
        raise FileNotFoundError(f"MicroPlastiX folder not found: {base}")
    meta = base / "metadata.json"
    if not meta.is_file():
        raise FileNotFoundError(f"MicroPlastiX metadata.json not found: {meta}")
    records = json.loads(meta.read_text(encoding="utf-8"))["data"]
    for rec in records:
        path = base / rec["file"]
        if not path.is_file():
            warnings.warn(f"MicroPlastiX file referenced but absent, skipped: {path}",
                          stacklevel=2)
            continue
        analysis, treatment = rec["Analysis"], rec["Treatment"]
        if analysis not in _TECHNIQUE:
            raise ValueError(f"{meta}: unknown Analysis {analysis!r} for {rec['file']}")
        if treatment not in _STATE:
            raise ValueError(f"{meta}: unknown Treatment {treatment!r} for {rec['file']}")
        technique = _TECHNIQUE[analysis]
        if technique == "ftir_atr" and rec.get("y_unit") != "A":
            raise ValueError(
                f"{path}: ATR record has y_unit {rec.get('y_unit')!r}, expected 'A' (absorbance)")
        x, y = _read_csv(path)
        raw = _text(rec["Polymer"])
        yield Spectrum(
            spectrum_id=f"mpx:{path.stem}", source="mpx", technique=technique, x=x, y=y,
            x_unit=rec["x_unit"], y_unit="absorbance" if technique == "ftir_atr" else "intensity",
            polymer=normalize_polymer(raw), polymer_raw=raw,
            state=_STATE[treatment], sample_group=f"mpx:{raw}", file=rel_posix(path, root),
            laser_nm=MPX_RAMAN_LASER_NM if technique == "raman" else None,
            extra={k: _text(rec.get(k)) for k in ("Region", "Campaign", "Exposure_days", "State")},
        )

