"""Reader for the FLOPP / FLOPP-e ATR-FTIR libraries."""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Literal

from microtrace_core.polymers import normalize_polymer
from microtrace_core.readers.common import read_spectrum_xy, rel_posix
from microtrace_core.spectrum import Spectrum

FLOPP_CODES = {
    "AC": "acrylic", "CO": "cotton", "CE": "cellulose", "R": "rubber",
    "PEVA": "eva", "EVA": "eva", "CA": "cellulose acetate",
}


def read_flopp(root: Path, variant: Literal["FLOPP", "FLOPP-e"]) -> Iterator[Spectrum]:
    source = "flopp" if variant == "FLOPP" else "flopp_e"
    state = "pristine" if variant == "FLOPP" else "weathered"
    folder = root / "Spectres" / f"{variant} .csv"
    if not folder.is_dir():
        raise FileNotFoundError(f"FLOPP folder not found: {folder}")
    for path in sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() == ".csv"):
        x, y = read_spectrum_xy(path, ",")
        code = path.stem.split(" ", 1)[0]
        sid = f"{source}:{path.stem}"
        yield Spectrum(
            spectrum_id=sid, source=source, technique="ftir_atr", x=x, y=y, x_unit="cm-1",
            y_unit="transmittance_pct",
            polymer=normalize_polymer(FLOPP_CODES.get(code, code)), polymer_raw=code,
            state=state, sample_group=sid, file=rel_posix(path, root),
        )
