"""Readers for the public spectral libraries."""
from microtrace_core.readers.flopp import read_flopp
from microtrace_core.readers.slopp import read_slopp
from microtrace_core.readers.weathered import read_weathered

__all__ = ["read_flopp", "read_slopp", "read_weathered"]
