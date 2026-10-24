"""Reading of reported values (censored notations) and detection status."""
from __future__ import annotations

import re
from dataclasses import dataclass

from microtrace_core.results.vocab import DetectionStatus, fold

_NUM = r"-?\d+(?:[.,]\d+)?"
_NUMBER = re.compile(rf"^{_NUM}$")
_BOUND = re.compile(rf"^<\s*({_NUM})$")
_STAR = re.compile(rf"^(?:\*({_NUM})|({_NUM})\*)$")

_NOT_ANALYSED = {"", "na", "n/a", "not analysed", "not analyzed", "non analyse"}
_BELOW_LOD = {"<lod", "< lod", "<ld", "nd", "n.d.", "n.d", "not detected", "non detecte"}
_NOT_QUANTIFIED = {"<loq", "< loq", "<lq"}

_DECLARED: dict[str, DetectionStatus] = {
    "quantified": DetectionStatus.quantified, ">loq": DetectionStatus.quantified,
    "q": DetectionStatus.quantified,
    "between_lod_loq": DetectionStatus.between_lod_loq,
    "lod-loq": DetectionStatus.between_lod_loq,
    "lod–loq": DetectionStatus.between_lod_loq,
    "not_quantified": DetectionStatus.not_quantified,
    "<loq": DetectionStatus.not_quantified,
    "below_lod": DetectionStatus.below_lod, "<lod": DetectionStatus.below_lod,
    "nd": DetectionStatus.below_lod,
    "not_analysed": DetectionStatus.not_analysed, "na": DetectionStatus.not_analysed,
}


@dataclass(frozen=True)
class Reported:
    value: float | None
    hint: DetectionStatus | None
    bound: float | None
    ok: bool


def _num(text: str) -> float:
    return float(text.replace(",", "."))


def parse_reported_value(text: str) -> Reported:
    """Parse a reported cell: number, ``<LOD``, ``n.d.``, ``< 0,68``, ``*1.2``..."""
    key = " ".join(fold(text.strip(" \xa0")).split())
    if key in _NOT_ANALYSED:
        return Reported(None, DetectionStatus.not_analysed, None, True)
    if key in _BELOW_LOD:
        return Reported(None, DetectionStatus.below_lod, None, True)
    if key in _NOT_QUANTIFIED:
        return Reported(None, DetectionStatus.not_quantified, None, True)
    if m := _BOUND.match(key):
        return Reported(None, None, _num(m.group(1)), True)
    if m := _STAR.match(key):
        return Reported(_num(m.group(1) or m.group(2)), DetectionStatus.between_lod_loq, None, True)
    if _NUMBER.match(key):
        return Reported(_num(key), None, None, True)
    return Reported(None, None, None, False)


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
    return _DECLARED.get("".join(fold(text.strip(" \xa0")).split()))
