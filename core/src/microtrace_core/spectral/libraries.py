"""Public spectral libraries: citation, licence and whether their curves may be shown."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class Library:
    code: str
    name: str
    citation: str
    url: str | None
    licence: str | None
    curve_allowed: bool


_PENDING = "À compléter"

LIBRARIES: Mapping[str, Library] = {
    lib.code: lib
    for lib in (
        Library("mpx", "MicroPlastiX SpecDB",
                "Lenz R. et al. (2023), doi:10.22000/1820",
                "https://doi.org/10.22000/1820", "CC BY-SA 4.0", True),
        Library("flopp", "FLOPP",
                "De Frond H., Rubinovitz R., Rochman C. (2021)", None, None, False),
        Library("flopp_e", "FLOPP-e",
                "De Frond H., Rubinovitz R., Rochman C. (2021)", None, None, False),
        Library("slopp", "SLoPP",
                "Munno K. et al. (2020)", None, None, False),
        Library("slopp_e", "SLoPP-E",
                "Munno K. et al. (2020)", None, None, False),
        Library("raspi", "RaSPI", _PENDING, None, None, False),
        Library("raman_weathered",
                "Base Raman de microplastiques vieillis en milieu naturel",
                _PENDING, None, None, False),
    )
}
