from __future__ import annotations

import pytest

from microtrace_core.spectral.thresholds import (
    LoloPrediction,
    NoThresholds,
    Status,
    Thresholds,
    choose_thresholds,
    round12,
    status_of,
)


def pred(lib, true, top, scores, *, classifier=None, in_library=True):
    return LoloPrediction(
        library=lib, true=true, in_library=in_library, top=tuple(top), scores=tuple(scores),
        classifier=top[0] if classifier is None else classifier, coverage=1.0,
        other_score=None, other_coverage=None)


def two_libraries(wrong_s1=0.78):
    out = []
    for lib in ("a", "b"):
        out += [pred(lib, "X", ["X", "Y", "Z"], [0.90, 0.80, 0.1]) for _ in range(50)]
        out += [pred(lib, "X", ["Y", "X", "Z"], [wrong_s1, 0.77, 0.1]) for _ in range(10)]
    return out


def test_round12():
    assert round12(0.90 - 0.80) == 0.1


def test_choose_thresholds_prefers_most_conservative_tie():
    assert choose_thresholds(two_libraries()) == Thresholds(0.50, 0.90, 0.10)


def _floor_case(b_right, b_wrong):
    preds = [pred("a", "X", ["X", "Y"], [0.90, 0.80]) for _ in range(500)]
    preds += [pred("b", "X", ["X", "Y"], [0.90, 0.80]) for _ in range(b_right)]
    preds += [pred("b", "X", ["Y", "X"], [0.90, 0.80]) for _ in range(b_wrong)]
    return preds


def test_choose_thresholds_library_floor():
    # global precision 518/521 = 0.994 passes; library b (18/21 = 85.7 %) is under 0.90
    with pytest.raises(NoThresholds):
        choose_thresholds(_floor_case(18, 3))


def test_library_floor_needs_twenty_answers():
    with pytest.raises(NoThresholds):  # 20 answers, 85 %: the floor applies
        choose_thresholds(_floor_case(17, 3))
    # 19 answers, 84 %: too few answers for the floor to apply
    assert choose_thresholds(_floor_case(16, 3)).identified_min_score == 0.90


def test_choose_thresholds_out_of_library_cap():
    preds = two_libraries()
    preds += [pred("a", "W", ["X", "Y"], [0.99, 0.49], in_library=False) for _ in range(20)]
    with pytest.raises(NoThresholds):
        choose_thresholds(preds)


def test_choose_thresholds_out_of_library_below_cap_is_ignored():
    preds = two_libraries()
    preds += [pred("a", "W", ["X", "Y"], [0.99, 0.49], in_library=False) for _ in range(19)]
    assert choose_thresholds(preds) == Thresholds(0.50, 0.90, 0.10)


def test_uncertain_threshold_falls_back_to_identified():
    preds = []
    for lib in ("a", "b"):
        preds += [pred(lib, "X", ["X", "Y"], [0.95, 0.5]) for _ in range(50)]
        # confident but wrong, second opinion disagrees, true polymer outside the top 3
        preds += [pred(lib, "X", ["Y", "Z", "W"], [0.96, 0.5, 0.4], classifier="Q")
                  for _ in range(20)]
    t = choose_thresholds(preds)
    assert t.uncertain_min_score == t.identified_min_score


T = Thresholds(0.5, 0.7, 0.05)


@pytest.mark.parametrize("s1,s2,agree,expected", [
    (0.7, 0.65, True, Status.IDENTIFIED),
    (0.6999999999, 0.5, True, Status.UNCERTAIN),
    (0.5, 0.4, False, Status.UNCERTAIN),
    (0.4999999999, 0.1, True, Status.NOT_IDENTIFIED),
    (0.99, 0.10, False, Status.UNCERTAIN),
    (0.99, 0.98, True, Status.UNCERTAIN),
    (None, None, True, Status.NOT_IDENTIFIED),
])
def test_status_boundaries(s1, s2, agree, expected):
    classifier = "PE" if agree else "PP"
    assert status_of(s1, s2, "PE", classifier, T) is expected


def test_technique_mismatch_conditions():
    from microtrace_core.spectral.model import technique_mismatch

    other_t = Thresholds(0.5, 0.7, 0.05)
    assert technique_mismatch(0.80, 0.90, 0.9, other_t)  # margin exactly 0.10 (rounded)
    assert not technique_mismatch(0.80, 0.8999999999, 0.9, other_t)  # margin just under
    assert not technique_mismatch(0.80, 0.90, 0.79, other_t)  # other coverage too low
    assert not technique_mismatch(0.50, 0.90, 0.9, Thresholds(0.95, 0.95, 0.1))  # < T_unc(other)
    assert technique_mismatch(0.50, 0.90, 0.9, Thresholds(0.90, 0.95, 0.1))  # == T_unc(other)
    assert not technique_mismatch(0.80, None, 0.9, other_t)
    assert not technique_mismatch(None, 0.9, 0.9, other_t)
