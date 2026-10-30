"""C7 quality rules q1 (all data simulated, except the published Table S2 reference)."""
from __future__ import annotations

import pytest

from microtrace_core.results import quality as q
from microtrace_core.results.importer import run_import
from microtrace_core.results.quality import (
    BlankSummary,
    NoteReason,
    QualityRecord,
    QualityRule,
    RecordRef,
    assess_quality,
    modified_z_scores,
    relative_range,
    signal_key,
)
from microtrace_core.results.records import MeasurementRecord
from microtrace_core.results.tables import read_table
from microtrace_core.results.units import UNITS
from microtrace_core.results.vocab import DetectionStatus as S
from microtrace_core.results.vocab import (
    IdentificationStatus,
    Matrix,
    RecordType,
    Technique,
)

from microtrace_core.results.examples import (
    LESLIE_2022_FILENAME,
    leslie_2022_context,
    leslie_2022_csv,
    leslie_2022_mapping,
)

from .conftest import (
    leslie_like_context,
    leslie_like_mapping,
    leslie_like_wide_table,
)

SHA = "a" * 64
_ROW = [1]


def rec(sample="S1", aliquot="a", status=S.quantified, value=1.0, polymer="PET",
        unit="ug/mL", method="M", matrix=Matrix.whole_blood, detail="", batch="",
        date="", rtype=RecordType.sample, technique=Technique.py_gc_ms, sha=SHA,
        row=None, column=None) -> MeasurementRecord:
    u = UNITS[unit]
    if row is None:
        _ROW[0] += 1
        row = _ROW[0]
    return MeasurementRecord(
        sample_id=sample, aliquot=aliquot, record_type=rtype, matrix=matrix,
        matrix_detail=detail, polymer=polymer, polymer_raw=polymer, method=method,
        technique=technique, reported_value="", value=value, unit=u,
        canonical_value=value, canonical_unit=u, status=status, lod=None, loq=None,
        canonical_lod=None, canonical_loq=None,
        identification_status=IdentificationStatus.confirmed, size_min_um=None,
        size_max_um=None, analysis_date=date, batch=batch, lab="", comment="",
        source_row=row, source_column=column or polymer,
    )


def qr(record: MeasurementRecord, sha: str = SHA) -> QualityRecord:
    return QualityRecord(RecordRef("imp", sha, "", record.source_row, record.source_column),
                         record)


def run(records, blanks=()):
    return assess_quality([qr(r) for r in records], blanks)


def blank(polymer="PET", mean=0.25, unit="ng/mL", kind="procedural_blank", id="B1", n=3):
    return BlankSummary(id, polymer, kind, n, mean, None, unit, "test")


def signals(result, rule):
    return [s for s in result.signals if s.rule == rule]


def notes(result, reason):
    return [n for n in result.notes if n.reason == reason]


def fig(signal):
    return dict(signal.figures)


def test_version_is_q1():
    assert q.QUALITY_RULES_VERSION == "q1"
    assert run([]).version == "q1"


def test_relative_range():
    assert relative_range([4.8, 2.6]) == pytest.approx(2.2 / 3.7)
    assert relative_range([1, 2, 3]) == 1.0


def test_discordance_above_threshold():
    res = run([rec(aliquot="a", value=4.8), rec(aliquot="b", value=2.6)])
    (s,) = signals(res, QualityRule.aliquot_discordance)
    assert fig(s)["rpd_percent"] == pytest.approx(59.459459, rel=1e-6)
    assert len(s.records) == 2 and s.sample_id == "S1"


def test_discordance_threshold_is_strict():
    res = run([rec(aliquot="a", value=1.25), rec(aliquot="b", value=0.75)])
    assert signals(res, QualityRule.aliquot_discordance) == []


def test_discordance_three_aliquots():
    res = run([rec(aliquot=a, value=v) for a, v in zip("abc", (1, 2, 3), strict=True)])
    (s,) = signals(res, QualityRule.aliquot_discordance)
    assert fig(s)["rpd_percent"] == 100.0 and fig(s)["n_quantified"] == 3


def test_discordance_ignores_censored():
    res = run([rec(aliquot="a", value=2.2),
               rec(aliquot="b", status=S.between_lod_loq, value=1.0)])
    assert signals(res, QualityRule.aliquot_discordance) == []


@pytest.mark.parametrize("change", [
    {"unit": "particles/mL"}, {"unit": "ug/g"}, {"method": "N"},
    {"matrix": Matrix.plasma}, {"matrix": Matrix.other, "detail": "other"},
    {"polymer": "PE"},
])
def test_discordance_never_pooled(change):
    other = dict(change)
    if other.get("matrix") is Matrix.other:  # the first one is "other" too, with another detail
        first = rec(aliquot="a", value=4.8, matrix=Matrix.other, detail="saliva")
    else:
        first = rec(aliquot="a", value=4.8)
    res = run([first, rec(aliquot="b", value=2.6, **other)])
    assert signals(res, QualityRule.aliquot_discordance) == []


def test_near_blank_converts_units():
    res = run([rec(value=0.6)], [blank(mean=250)])
    (s,) = signals(res, QualityRule.near_blank)
    assert fig(s)["ratio"] == 2.4 and fig(s)["blank_mean"] == 0.25
    assert s.blank is not None and s.blank.id == "B1"


def test_near_blank_is_strict():
    assert signals(run([rec(value=0.75)], [blank(mean=250)]), QualityRule.near_blank) == []


def test_near_blank_ignores_censored():
    res = run([rec(status=S.between_lod_loq, value=0.2)], [blank(mean=250)])
    assert signals(res, QualityRule.near_blank) == []


def test_near_blank_unit_mismatch():
    res = run([rec(value=0.6)], [blank(mean=250, unit="particles/mL")])
    assert signals(res, QualityRule.near_blank) == []
    (n,) = notes(res, NoteReason.blank_unit_mismatch)
    assert n.blank is not None and n.group is not None
    res = run([rec(value=0.6)], [blank(mean=250, unit="furlong")])
    assert signals(res, QualityRule.near_blank) == []
    assert len(notes(res, NoteReason.blank_unit_unknown)) == 1


def test_near_blank_kind_and_mean():
    res = run([rec(value=0.6)], [blank(kind="field_blank")])
    assert len(notes(res, NoteReason.no_blank_summary)) == 1
    for mean in (None, 0.0):
        res = run([rec(value=0.6)], [blank(mean=mean)])
        assert signals(res, QualityRule.near_blank) == []
        assert len(notes(res, NoteReason.blank_mean_missing)) == 1


def test_near_blank_ps_sum():
    r = rec(polymer="PS_SUM", value=0.5)
    (s,) = signals(run([r], [blank(polymer="PS", mean=250)]), QualityRule.near_blank)
    assert s.group.polymer == "PS_SUM"


def test_near_blank_polymers_without_blank():
    res = run([rec(value=5), rec(polymer="PE", value=5)], [blank(mean=250)])
    (n,) = notes(res, NoteReason.polymers_without_blank)
    assert n.polymers == ("PE",)


def test_modified_z_scores():
    z = modified_z_scores([1, 1.1, 1.2, 1.3, 10])
    assert z is not None and z[-1] == pytest.approx(59.356, abs=1e-3)
    assert modified_z_scores([1, 1, 1, 1, 5]) is None


def _outlier_records(extra: float, others=(1, 1.1, 1.2, 1.3)):
    out = [rec(sample="X", value=extra)]
    out += [rec(sample=f"o{i}", value=v) for i, v in enumerate(others)]
    return out


def test_outlier_flags_both_sides():
    (s,) = signals(run(_outlier_records(10)), QualityRule.robust_outlier)
    f = fig(s)
    assert s.sample_id == "X" and f["median"] == 1.2 and f["mad"] == pytest.approx(0.1)
    assert f["n"] == 5
    (s,) = signals(run(_outlier_records(0.5, (10, 10.1, 10.2, 10.3))), QualityRule.robust_outlier)
    assert fig(s)["z"] == pytest.approx(-64.75, abs=0.01)


def test_outlier_uses_engine_aggregation():
    recs = [rec(sample="X", aliquot="a", value=9), rec(sample="X", aliquot="b", value=11)]
    recs += [rec(sample=f"o{i}", value=v) for i, v in enumerate((1, 1.1, 1.2, 1.3))]
    (s,) = signals(run(recs), QualityRule.robust_outlier)
    assert fig(s)["value"] == 10 and len(s.records) == 2


def test_outlier_needs_five():
    recs = [rec(sample=f"s{i}", value=v) for i, v in enumerate((1, 2, 3, 40))]
    res = run(recs)
    (n,) = notes(res, NoteReason.too_few_samples)
    assert n.count == 4 and signals(res, QualityRule.robust_outlier) == []
    res = run([rec(status=S.below_lod, value=None)])
    (n,) = notes(res, NoteReason.too_few_samples)
    assert n.count == 0


def test_outlier_zero_mad():
    recs = [rec(sample=f"s{i}", value=v) for i, v in enumerate((1, 1, 1, 1, 5))]
    res = run(recs)
    assert len(notes(res, NoteReason.zero_mad)) == 1
    assert signals(res, QualityRule.robust_outlier) == []


def _lod(batches: dict[str, tuple[int, int]], dimension="batch", **kw):
    """batches: label -> (n below LOD, n total)."""
    out = []
    for label, (k, n) in batches.items():
        for i in range(n):
            st = S.below_lod if i < k else S.quantified
            out.append(rec(sample=f"{label}{i}", status=st, value=None if i < k else 1.0,
                           **{dimension: label}, **kw))
    return out


def lod_signals(res):
    return signals(res, QualityRule.unusual_lod_rate)


def test_lod_rate_fisher():
    res = run(_lod({"A": (9, 10), "B": (1, 10), "C": (2, 10)}, dimension="batch"))
    (s,) = lod_signals(res)
    assert s.stratum == "A" and s.dimension == "batch"
    assert fig(s)["p_value"] == pytest.approx(0.000133999, rel=1e-6)
    (n,) = notes(res, NoteReason.tests_performed)
    assert n.count == 3


def test_lod_rate_two_strata_single_test():
    res = run(_lod({"A": (9, 10), "B": (1, 10)}))
    (s,) = lod_signals(res)
    assert s.stratum == "A" and fig(s)["p_value"] == pytest.approx(0.0010933, rel=1e-3)
    assert notes(res, NoteReason.tests_performed)[0].count == 1


def test_lod_rate_min_stratum():
    res = run(_lod({"A": (5, 5), "B": (0, 5)}))
    (s,) = lod_signals(res)
    assert fig(s)["p_value"] == pytest.approx(0.0079, abs=1e-4)
    res = run(_lod({"A": (4, 4), "B": (0, 6)}))
    assert lod_signals(res) == []
    assert len(notes(res, NoteReason.too_few_in_strata)) == 1
    res = run(_lod({"A": (5, 5), "B": (0, 5), "C": (0, 4)}))
    assert "C" not in [s.stratum for s in lod_signals(res)]  # a batch of 4 is never compared
    assert notes(res, NoteReason.tests_performed)[0].count == 2


def test_lod_rate_empty_dimension():
    res = run([rec(sample=f"s{i}") for i in range(3)])
    assert sorted(n.dimension for n in notes(res, NoteReason.dimension_empty)) == [
        "analysis_date", "batch"]
    # measurements without a batch are neither a stratum nor part of the rest
    recs = _lod({"A": (5, 5)}) + [rec(sample=f"z{i}", status=S.quantified) for i in range(8)]
    res = run(recs)
    assert lod_signals(res) == []
    assert len(notes(res, NoteReason.too_few_in_strata)) == 1


def test_lod_rate_excludes_not_analysed():
    recs = _lod({"A": (5, 5), "B": (0, 5)}) + [
        rec(sample=f"n{i}", status=S.not_analysed, value=None, batch="B") for i in range(20)]
    (s,) = lod_signals(run(recs))
    assert fig(s)["n_stratum"] == 5 and fig(s)["n_rest"] == 5


def test_lod_rate_by_analysis_date():
    res = run(_lod({"2024-01-01": (9, 10), "2024-01-02": (1, 10)}, dimension="date"))
    (s,) = lod_signals(res)
    assert s.dimension == "analysis_date" and s.stratum == "2024-01-01"


def _keys(res):
    return {s.key for s in res.signals}


def _key_fixture():
    recs = [rec(sample="16", aliquot="a", polymer="PE", value=7.1),
            rec(sample="16", aliquot="b", polymer="PE", value=4.0)]
    recs += [rec(sample=f"o{i}", polymer="PE", value=v) for i, v in enumerate((2.4, 2.5, 2.6, 2.5))]
    return recs


def test_keys_stable_and_specific(monkeypatch):
    recs = _key_fixture()
    base = run(recs)
    assert len(base.signals) >= 2
    assert all(len(s.key) == 64 and int(s.key, 16) >= 0 for s in base.signals)
    assert _keys(run(list(reversed(recs)))) == _keys(base)
    unrelated = [rec(sample="p", polymer="PA", value=3.0) for _ in range(2)]
    more = assess_quality([qr(r) for r in recs] + [qr(r, "b" * 64) for r in unrelated])
    assert _keys(base) <= _keys(more)
    changed = [qr(r) for r in recs]
    changed[0] = qr(recs[0], "c" * 64)
    assert _keys(assess_quality(changed)) != _keys(base)
    monkeypatch.setattr(q, "QUALITY_RULES_VERSION", "q2")
    again = run(recs)
    assert again.version == "q2" and not (_keys(again) & _keys(base))


def test_signal_key_ignores_order_of_refs():
    g = run(_key_fixture()).signals[0].group
    a, b = RecordRef("i", SHA, "", 2, "PE"), RecordRef("i", SHA, "", 3, "PE")
    k = signal_key(QualityRule.aliquot_discordance, g, {"sample": "x"}, [a, b])
    assert k == signal_key(QualityRule.aliquot_discordance, g, {"sample": "x"}, [b, a])
    assert k != signal_key(QualityRule.robust_outlier, g, {"sample": "x"}, [a, b])


def _leslie_like(blanks=()):
    table = leslie_like_wide_table()
    result = run_import(table, leslie_like_mapping(table), leslie_like_context())
    assert not result.has_errors
    return assess_quality([qr(r) for r in result.records], blanks)


def _subjects(res, rule):
    return [(s.sample_id, s.group.polymer) for s in signals(res, rule)]


def test_leslie_like_reference():
    res = _leslie_like()
    D, O = QualityRule.aliquot_discordance, QualityRule.robust_outlier
    assert [(s.rule, s.sample_id, s.group.polymer) for s in res.signals] == [
        (D, "16", "PE"), (D, "12", "PS_SUM"), (O, "16", "PE"), (O, "4", "PE")]
    d = signals(res, D)
    assert [fig(s)["rpd_percent"] for s in d] == [pytest.approx(55.856, abs=1e-3),
                                                  pytest.approx(59.459, abs=1e-3)]
    o = signals(res, O)
    assert [fig(s)["z"] for s in o] == [pytest.approx(20.572, abs=1e-3),
                                        pytest.approx(7.4195, abs=1e-3)]
    assert [n.reason for n in res.notes if n.rule == QualityRule.near_blank] == [
        NoteReason.no_blank_summary]
    few = notes(res, NoteReason.too_few_samples)
    assert sorted((n.group.polymer, n.count) for n in few) == [("PMMA", 1), ("PP", 0)]
    assert [n.dimension for n in notes(res, NoteReason.dimension_empty)] == [
        "batch", "analysis_date"]
    assert len(res.notes) == 5

    with_blank = _leslie_like([blank(mean=250)])
    nb = signals(with_blank, QualityRule.near_blank)
    assert [(s.sample_id, s.aliquot) for s in nb] == [
        ("10", "a"), ("11", "b"), ("4", "a"), ("4", "b"), ("6", "a"), ("7", "a")]
    assert [fig(s)["ratio"] for s in nb] == [pytest.approx(x) for x in
                                              (1.8, 2.8, 2.4, 2.0, 2.8, 2.0)]
    (pw,) = notes(with_blank, NoteReason.polymers_without_blank)
    assert pw.polymers == ("PE", "PMMA", "PP", "PS_SUM")
    assert {s.key for s in res.signals} <= _keys(with_blank)


def test_leslie_2022_reference():
    table = read_table(leslie_2022_csv(), LESLIE_2022_FILENAME)
    result = run_import(table, leslie_2022_mapping(table), leslie_2022_context())
    assert not result.has_errors
    res = assess_quality([qr(r) for r in result.records])
    D, O = QualityRule.aliquot_discordance, QualityRule.robust_outlier
    assert [(s.rule, s.sample_id, s.group.polymer) for s in res.signals] == [
        (D, "12", "PS_SUM"), (D, "13", "PS_SUM"), (O, "7", "PET")]
    d12, d13, o7 = res.signals
    assert fig(d12)["rpd_percent"] == 120.0
    assert fig(d13)["rpd_percent"] == pytest.approx(112.727, abs=1e-3)
    assert fig(o7)["z"] == pytest.approx(3.5074, abs=1e-4)
    assert signals(res, QualityRule.unusual_lod_rate) == []
