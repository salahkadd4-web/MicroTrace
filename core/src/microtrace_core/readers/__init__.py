"""Readers for the public spectral libraries."""
from collections.abc import Iterator
from pathlib import Path

from microtrace_core.readers.flopp import read_flopp
from microtrace_core.readers.mpx import read_mpx
from microtrace_core.readers.raspi import read_raspi
from microtrace_core.readers.slopp import read_slopp
from microtrace_core.readers.weathered import read_weathered
from microtrace_core.spectrum import Spectrum


def iter_all(root: Path) -> Iterator[Spectrum]:
    """Every spectrum of every library, in a fixed source order."""
    yield from read_mpx(root)
    yield from read_flopp(root, "FLOPP")
    yield from read_flopp(root, "FLOPP-e")
    yield from read_slopp(root, "SLoPP")
    yield from read_slopp(root, "SLoPP-E")
    yield from read_raspi(root)
    yield from read_weathered(root)


__all__ = ["iter_all", "read_flopp", "read_mpx", "read_raspi", "read_slopp",
           "read_weathered"]
