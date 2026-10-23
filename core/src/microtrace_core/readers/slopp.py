"""Reader for the SLoPP / SLoPP-E Raman libraries."""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Literal

from microtrace_core.polymers import normalize_polymer
from microtrace_core.readers.common import read_spectrum_xy, rel_posix
from microtrace_core.spectrum import Spectrum


def read_slopp(root: Path, variant: Literal["SLoPP", "SLoPP-E"]) -> Iterator[Spectrum]:
    source = "slopp" if variant == "SLoPP" else "slopp_e"
    state = "pristine" if variant == "SLoPP" else "weathered"
    base = root / "Spectres" / "SLoPP and SLoPP-E" / variant
    if not base.is_dir():
        raise FileNotFoundError(f"SLoPP folder not found: {base}")
    for folder in sorted(p for p in base.iterdir() if p.is_dir()):
        for path in sorted(p for p in folder.iterdir()
                           if p.is_file() and p.suffix.lower() == ".txt"):
            x, y = read_spectrum_xy(path, "\t")
            sid = f"{source}:{folder.name}/{path.stem}"
            yield Spectrum(
                spectrum_id=sid, source=source, technique="raman", x=x, y=y, x_unit="cm-1",
                polymer=normalize_polymer(folder.name), polymer_raw=folder.name,
                state=state, sample_group=sid, file=rel_posix(path, root),
            )
