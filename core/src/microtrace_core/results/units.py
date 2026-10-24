"""Unit registry: parsing and same-(kind, basis) conversion only."""
from __future__ import annotations

import re
from dataclasses import dataclass

from microtrace_core.results.vocab import Basis, QuantityKind

_MASS = QuantityKind.mass_concentration
_NUM = QuantityKind.number_concentration
_VOL = Basis.per_volume
_MS = Basis.per_mass


class UnitMismatchError(ValueError):
    """Raised when converting between different (kind, basis) pairs."""


@dataclass(frozen=True)
class Unit:
    code: str
    label: str
    kind: QuantityKind
    basis: Basis
    factor: float  # multiplier to the canonical unit of (kind, basis)


UNITS: dict[str, Unit] = {u.code: u for u in (
    Unit("ug/mL", "µg/mL", _MASS, _VOL, 1.0),
    Unit("ng/mL", "ng/mL", _MASS, _VOL, 0.001),
    Unit("mg/L", "mg/L", _MASS, _VOL, 1.0),
    Unit("ug/L", "µg/L", _MASS, _VOL, 0.001),
    Unit("ug/g", "µg/g", _MASS, _MS, 1.0),
    Unit("ng/g", "ng/g", _MASS, _MS, 0.001),
    Unit("mg/kg", "mg/kg", _MASS, _MS, 1.0),
    Unit("particles/mL", "particules/mL", _NUM, _VOL, 1.0),
    Unit("particles/L", "particules/L", _NUM, _VOL, 0.001),
    Unit("particles/g", "particules/g", _NUM, _MS, 1.0),
)}

_CANONICAL: dict[tuple[QuantityKind, Basis], str] = {
    (_MASS, _VOL): "ug/mL",
    (_MASS, _MS): "ug/g",
    (_NUM, _VOL): "particles/mL",
    (_NUM, _MS): "particles/g",
}

_SYNONYMS: dict[str, str] = {}
for _code in UNITS:
    _SYNONYMS[_code.lower()] = _code
_SYNONYMS.update({
    "particules/ml": "particles/mL", "p/ml": "particles/mL", "mps/ml": "particles/mL",
    "items/ml": "particles/mL", "particles/ml": "particles/mL",
    "particules/l": "particles/L", "p/l": "particles/L", "mps/l": "particles/L",
    "items/l": "particles/L",
    "particules/g": "particles/g", "p/g": "particles/g", "mps/g": "particles/g",
    "items/g": "particles/g",
})



def _normalize(text: str) -> str:
    s = text.strip().lower()
    for ch in ("μ", "µ"):
        s = s.replace(ch, "u")
    s = "".join(s.split())
    # "ug·ml⁻¹" / "ugml-1" -> "ug/ml": numerator is everything before the denominator
    m = re.match(r"^(.+?)·?(ml|kg|l|g)(?:⁻¹|-1)$", s)
    if m and m.group(1):
        s = f"{m.group(1)}/{m.group(2)}"
    return s


def parse_unit(text: str) -> Unit | None:
    if not text:
        return None
    code = _SYNONYMS.get(_normalize(text))
    return UNITS[code] if code else None


def canonical_unit(kind: QuantityKind, basis: Basis) -> Unit:
    return UNITS[_CANONICAL[(kind, basis)]]


def convert(value: float, src: Unit, dst: Unit) -> float:
    if (src.kind, src.basis) != (dst.kind, dst.basis):
        raise UnitMismatchError(
            f"Conversion impossible entre {src.code} et {dst.code} "
            "(grandeur ou base différente)"
        )
    return value * src.factor / dst.factor


def to_canonical(value: float, unit: Unit) -> tuple[float, Unit]:
    dst = canonical_unit(unit.kind, unit.basis)
    return convert(value, unit, dst), dst
