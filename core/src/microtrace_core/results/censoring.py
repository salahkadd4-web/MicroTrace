"""Reading of reported values (censored notations) and detection status."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

from microtrace_core.results.vocab import DetectionStatus, fold

_NUM = r"-?\d+(?:[.,]\d+)?"
_NUMBER = re.compile(rf"^{_NUM}(?:e[+-]?\d+)?$")  # a plain number may carry an exponent
_BOUND = re.compile(rf"^<\s*({_NUM})$")
_STAR = re.compile(rf"^(?:\*({_NUM})|({_NUM})\*)$")

_NOT_ANALYSED = {"", "na", "n/a", "not analysed", "not analyzed", "non analyse"}
_BELOW_LOD = {"<lod", "<ld", "nd", "n.d.", "n.d", "not detected", "non detecte"}
_NOT_QUANTIFIED = {"<loq", "<lq"}

# a declared status accepts every notation of a reported value, plus status words
_DECLARED: dict[str, DetectionStatus] = {
    **{k: DetectionStatus.not_analysed for k in _NOT_ANALYSED if k},
    **{k: DetectionStatus.below_lod for k in _BELOW_LOD},
    **{k: DetectionStatus.not_quantified for k in _NOT_QUANTIFIED},
    "quantified": DetectionStatus.quantified, ">loq": DetectionStatus.quantified,
    "q": DetectionStatus.quantified,
    "between lod loq": DetectionStatus.between_lod_loq,
    "between lod-loq": DetectionStatus.between_lod_loq,
    "between lod and loq": DetectionStatus.between_lod_loq,
    "lod-loq": DetectionStatus.between_lod_loq,
    "not quantified": DetectionStatus.not_quantified,
    "below lod": DetectionStatus.below_lod,
}
_AFTER_LT_GT = re.compile(r"([<>])\s+")
_DASH = re.compile(r"\s*[-–—]\s*")


@dataclass(frozen=True)
class Reported:
    value: float | None
    hint: DetectionStatus | None
    bound: float | None
    ok: bool


def _key(text: str) -> str:
    """Folded, single-spaced, no space after "<" or ">" ("< LD" -> "<ld")."""
    return _AFTER_LT_GT.sub(r"\1", " ".join(fold(text.strip(" \xa0")).split()))


def _num(text: str) -> float | None:
    """The number, or None when it overflows to infinity ("1e999", 400 digits)."""
    value = float(text.replace(",", "."))
    return value if math.isfinite(value) else None


_UNREADABLE = Reported(None, None, None, False)


def parse_reported_value(text: str) -> Reported:
    """Parse a reported cell: number, ``<LOD``, ``n.d.``, ``< 0,68``, ``*1.2``, ``1e-05``...

    Every number is finite: "inf", "nan" or an overflowing "1e999" is unreadable (ok=False).
    """
    key = _key(text)
    if key in _NOT_ANALYSED:
        return Reported(None, DetectionStatus.not_analysed, None, True)
    if key in _BELOW_LOD:
        return Reported(None, DetectionStatus.below_lod, None, True)
    if key in _NOT_QUANTIFIED:
        return Reported(None, DetectionStatus.not_quantified, None, True)
    if m := _BOUND.match(key):
        bound = _num(m.group(1))
        return Reported(None, None, bound, True) if bound is not None else _UNREADABLE
    if m := _STAR.match(key):
        value = _num(m.group(1) or m.group(2))
        if value is None:
            return _UNREADABLE
        return Reported(value, DetectionStatus.between_lod_loq, None, True)
    if _NUMBER.match(key) and (value := _num(key)) is not None:
        return Reported(value, None, None, True)
    return _UNREADABLE


def infer_status(r: Reported, lod: float | None, loq: float | None) -> DetectionStatus | None:
    """Detection status from the reported value and the limits, or None if undeterminable."""
    if r.hint is not None:
        return r.hint
    if lod is None and loq is None:
        return None
    if r.bound is not None:
        if lod is not None and r.bound <= lod:
            return DetectionStatus.below_lod
        return DetectionStatus.not_quantified if loq is not None else None
    if r.value is None:
        return None
    if lod is not None and r.value < lod:
        return DetectionStatus.below_lod
    if loq is None:
        return None  # LOD only and value >= LOD: quantification cannot be checked
    if r.value >= loq:
        return DetectionStatus.quantified
    return DetectionStatus.between_lod_loq if lod is not None else DetectionStatus.not_quantified


def parse_declared_status(text: str) -> DetectionStatus | None:
    """Declared status: a status name (``below_lod``), a status word, or a reported notation."""
    return _DECLARED.get(_DASH.sub("-", _key(text.replace("_", " "))))
