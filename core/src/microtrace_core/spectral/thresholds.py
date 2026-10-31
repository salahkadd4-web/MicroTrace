"""Status thresholds: deterministic choice on LOLO predictions, and the status rule."""
from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

UNCERTAIN_GRID = (0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95)
IDENTIFIED_GRID = (0.70, 0.75, 0.80, 0.85, 0.90, 0.95)
MARGIN_GRID = (0.0, 0.01, 0.02, 0.03, 0.05, 0.10)
IDENTIFIED_MIN_PRECISION = 0.95
LIBRARY_MIN_PRECISION = 0.90
UNCERTAIN_MIN_TOP3 = 0.95
LIBRARY_MIN_TOP3 = 0.90
OUT_OF_LIBRARY_MAX_IDENTIFIED = 0.10
MIN_LIBRARY_ANSWERS = 20
MIN_OUT_OF_LIBRARY = 20


class Status(StrEnum):
    IDENTIFIED = "identified"
    UNCERTAIN = "uncertain"
    NOT_IDENTIFIED = "not_identified"


@dataclass(frozen=True)
class Thresholds:
    uncertain_min_score: float
    identified_min_score: float
    identified_min_margin: float


@dataclass(frozen=True)
class LoloPrediction:
    library: str
    true: str
    in_library: bool
    top: tuple[str, ...]
    scores: tuple[float, ...]
    classifier: str | None
    coverage: float
    other_score: float | None
    other_coverage: float | None


class NoThresholds(ValueError):
    """No grid point satisfies the selection criteria."""


def round12(x: float) -> float:
    """Round to 12 significant digits (display-consistent comparison)."""
    return float(f"{x:.12g}")


def _s1_s2(p: LoloPrediction) -> tuple[float | None, float | None]:
    s1 = p.scores[0] if p.scores else None
    s2 = p.scores[1] if len(p.scores) > 1 else None
    return s1, s2


def _is_identified(p: LoloPrediction, t_id: float, m_id: float) -> bool:
    s1, s2 = _s1_s2(p)
    if s1 is None or not math.isfinite(s1) or not p.top:
        return False
    margin = math.inf if s2 is None else round12(s1 - s2)
    return (round12(s1) >= t_id and margin >= m_id
            and p.classifier is not None and p.classifier == p.top[0])


def status_of(s1: float | None, s2: float | None, top1: str | None,
              classifier: str | None, t: Thresholds) -> Status:
    """Status from the correlation scores and the second opinion (guards aside)."""
    if s1 is None or not math.isfinite(s1):
        return Status.NOT_IDENTIFIED
    s1 = round12(s1)
    if s1 < t.uncertain_min_score:
        return Status.NOT_IDENTIFIED
    margin = math.inf if s2 is None or not math.isfinite(s2) else round12(s1 - round12(s2))
    if (s1 >= t.identified_min_score and margin >= t.identified_min_margin
            and classifier is not None and classifier == top1):
        return Status.IDENTIFIED
    return Status.UNCERTAIN


def choose_thresholds(preds: Sequence[LoloPrediction]) -> Thresholds:
    """Pick (T_unc, T_id, M_id) from LOLO predictions; see the design, section 5.3."""
    inside = [p for p in preds if p.in_library]
    outside = [p for p in preds if not p.in_library]

    best: tuple[int, float, float] | None = None
    for t_id in IDENTIFIED_GRID:
        for m_id in MARGIN_GRID:
            ident = [p for p in inside if _is_identified(p, t_id, m_id)]
            if not ident:
                continue
            correct = sum(p.top[0] == p.true for p in ident)
            if correct / len(ident) < IDENTIFIED_MIN_PRECISION:
                continue
            per_lib: dict[str, list[bool]] = defaultdict(list)
            for p in ident:
                per_lib[p.library].append(p.top[0] == p.true)
            if any(len(v) >= MIN_LIBRARY_ANSWERS and sum(v) / len(v) < LIBRARY_MIN_PRECISION
                   for v in per_lib.values()):
                continue
            if len(outside) >= MIN_OUT_OF_LIBRARY:
                share = sum(_is_identified(p, t_id, m_id) for p in outside) / len(outside)
                if share > OUT_OF_LIBRARY_MAX_IDENTIFIED:
                    continue
            key = (len(ident), t_id, m_id)  # most answers, then most conservative
            if best is None or key > best:
                best = key
    if best is None:
        raise NoThresholds("no threshold pair satisfies the selection criteria")
    _, t_id, m_id = best

    t_unc = t_id
    for t in UNCERTAIN_GRID:
        if t > t_id:
            break
        above = [p for p in inside if p.scores and round12(p.scores[0]) >= t]
        if not above:
            continue
        hit = [p.true in p.top[:3] for p in above]
        if sum(hit) / len(hit) < UNCERTAIN_MIN_TOP3:
            continue
        per_lib_hit: dict[str, list[bool]] = defaultdict(list)
        for p, h in zip(above, hit, strict=True):
            per_lib_hit[p.library].append(h)
        if any(len(v) >= MIN_LIBRARY_ANSWERS and sum(v) / len(v) < LIBRARY_MIN_TOP3
               for v in per_lib_hit.values()):
            continue
        t_unc = t
        break
    return Thresholds(t_unc, t_id, m_id)
