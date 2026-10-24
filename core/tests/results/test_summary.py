"""Honest aggregation, frequencies and statistics (all data simulated)."""
from __future__ import annotations

from dataclasses import fields, replace

import pytest

from microtrace_core.results.importer import run_import
from microtrace_core.results.mapping import Mapping
from microtrace_core.results.records import MeasurementRecord
from microtrace_core.results.summary import (
    AGGREGATION_RULE_FR,
    Frequency,
    PolymerStats,
    aggregate_aliquots,
    describe,
    quantification_frequency,
)
from microtrace_core.results.tables import RawTable
from microtrace_core.results.units import UNITS
from microtrace_core.results.vocab import (
    DetectionStatus as S,
)
from microtrace_core.results.vocab import (
    IdentificationStatus,
    Matrix,
    RecordType,
    Technique,
)
from .conftest import (
    leslie_like_context,
    leslie_like_mapping,
    leslie_like_wide_table,
)


def rec(sample="S1", aliquot="a", status=S.quantified, value=1.0, polymer="PET",
        unit="ug/mL", rtype=RecordType.sample) -> MeasurementRecord:
    u = UNITS[unit]
    return MeasurementRecord(
        sample_id=sample, aliquot=aliquot, record_type=rtype, matrix=Matrix.whole_blood,
        matrix_detail="", polymer=polymer, polymer_raw=polymer, method="M",
        technique=Technique.py_gc_ms, reported_value="", value=value, unit=u,
        canonical_value=value, canonical_unit=u, status=status, lod=None, loq=None,
        canonical_lod=None, canonical_loq=None,
        identification_status=IdentificationStatus.confirmed, size_min_um=None,
        size_max_um=None, analysis_date="", batch="", lab="", comment="",
        source_row=2, source_column=polymer,
    )


def rec_m(method, **kw):
    return replace(rec(**kw), method=method)


def test_describe_never_pools_methods():
    recs = [rec_m("M1", value=1.0), rec_m("M2", value=3.0)]
    stats = describe(recs)
    assert [(s.method, s.n_quantified, s.mean) for s in stats] == [("M1", 1, 1.0), ("M2", 1, 3.0)]
    assert all(sum(s.counts_by_status.values()) == 1 for s in stats)


def test_frequency_partial_fraction():
    recs = [rec(sample="S1"), rec(sample="S2", status=S.below_lod, value=None),
            rec(sample="S3", polymer="PE")]
    f = {x.polymer: x for x in quantification_frequency(recs)}
    assert (f["PET"].n_quantified, f["PET"].n_samples) == (1, 2)
    assert f["PET"].fraction == pytest.approx(1 / 2)
    assert (f["ANY"].n_quantified, f["ANY"].n_samples) == (2, 3)


def test_status_rank_ordering():
    recs = [rec(aliquot="a", status=S.not_quantified, value=None),
            rec(aliquot="b", status=S.below_lod, value=None),
            rec(aliquot="c", status=S.between_lod_loq, value=0.3)]
    assert aggregate_aliquots(recs)[0].status == S.between_lod_loq
    assert aggregate_aliquots(recs[:2])[0].status == S.not_quantified


def test_rule_text():
    assert AGGREGATION_RULE_FR == (
        "Valeur par échantillon = moyenne des aliquotes quantifiées (≥ LOQ) ; si aucune "
        "aliquote n'est quantifiée, statut le plus élevé observé, sans valeur. "
        "Aucune imputation."
    )


def test_aggregate_mean_of_quantified_only():
    out = aggregate_aliquots([rec(aliquot="a", value=2.0),
                              rec(aliquot="b", status=S.between_lod_loq, value=0.3)])
    assert len(out) == 1
    r = out[0]
    assert r.value == 2.0 and r.status == S.quantified
    assert r.n_quantified == 1 and r.n_aliquots == 2


def test_aggregate_mean_of_two_quantified():
    out = aggregate_aliquots([rec(aliquot="a", value=1.0), rec(aliquot="b", value=2.0)])
    assert out[0].value == pytest.approx(1.5) and out[0].n_quantified == 2


def test_aggregate_no_quantified_takes_highest_status():
    out = aggregate_aliquots([rec(aliquot="a", status=S.below_lod, value=None),
                              rec(aliquot="b", status=S.between_lod_loq, value=0.3)])
    assert out[0].status == S.between_lod_loq
    assert out[0].value is None and out[0].n_quantified == 0


def test_qc_records_excluded_from_summary():
    recs = [rec(), rec(sample="B1", rtype=RecordType.procedural_blank),
            rec(sample="F1", rtype=RecordType.field_blank),
            rec(sample="K1", rtype=RecordType.spiked)]
    assert [r.sample_id for r in aggregate_aliquots(recs)] == ["S1"]
    freq = {f.polymer: f for f in quantification_frequency(recs)}
    assert freq["PET"].n_samples == 1
    assert describe(recs)[0].n_quantified == 1


def test_describe_never_mixes_kinds():
    recs = [rec(value=2.0), rec(unit="particles/mL", value=500.0),
            rec(sample="S2", unit="particles/mL", value=100.0)]
    stats = describe(recs)
    assert len(stats) == 2
    by = {s.canonical_unit.code: s for s in stats}
    assert by["ug/mL"].max == 2.0
    assert by["particles/mL"].max == 500.0 and by["particles/mL"].n_quantified == 2


def test_describe_statistics_and_status_counts():
    recs = [rec(sample="S1", value=1.0), rec(sample="S2", value=3.0),
            rec(sample="S2", aliquot="b", value=5.0),
            rec(sample="S3", status=S.below_lod, value=None)]
    s = describe(recs)[0]
    assert s.counts_by_status == {
        "quantified": 2, "between_lod_loq": 0, "not_quantified": 0,
        "below_lod": 1, "not_analysed": 0}
    assert (s.min, s.median, s.mean, s.max) == (1.0, 2.5, 2.5, 4.0)
    assert s.max_measurement == 5.0


def test_frequency_order_and_empty():
    recs = [rec(polymer="PS_SUM"), rec(polymer="PE", status=S.below_lod, value=None)]
    freq = quantification_frequency(recs)
    assert [f.polymer for f in freq] == ["PE", "PS_SUM", "ANY"]
    assert freq[-1].n_quantified == 1 and freq[-1].fraction == 1.0
    assert quantification_frequency([]) == []  # no sample, no matrix: no ANY row


def test_leslie_like_frequencies_and_maxima():
    table = leslie_like_wide_table()
    result = run_import(table, leslie_like_mapping(table), leslie_like_context())
    wb = Matrix.whole_blood
    freq = {(f.polymer, f.matrix): (f.n_quantified, f.n_samples)
            for f in quantification_frequency(result.records)}
    assert freq == {("PET", wb): (11, 22), ("PS_SUM", wb): (8, 22), ("PE", wb): (5, 22),
                    ("PMMA", wb): (1, 22), ("PP", wb): (0, 22), ("ANY", wb): (17, 22)}
    assert [f.polymer for f in quantification_frequency(result.records)][-1] == "ANY"
    assert {s.matrix for s in describe(result.records)} == {wb}
    stats = {s.polymer: s for s in describe(result.records)}
    assert stats["PET"].max_measurement == pytest.approx(2.4)
    assert stats["PS_SUM"].max_measurement == pytest.approx(4.8)
    assert stats["PE"].max_measurement == pytest.approx(7.1)
    assert stats["PP"].n_quantified == 0 and stats["PP"].median is None


# ---- final review ----


def test_frequency_denominator_only_samples_analysed_for_that_polymer():
    recs = [rec(sample="S1"), rec(sample="S2", polymer="PE"),
            rec(sample="S3", status=S.not_analysed, value=None),
            rec(sample="S3", polymer="PE", status=S.below_lod, value=None),
            rec(sample="S4", status=S.not_analysed, value=None)]
    f = {x.polymer: (x.n_quantified, x.n_samples) for x in quantification_frequency(recs)}
    assert f == {"PET": (1, 1), "PE": (1, 2), "ANY": (2, 3)}


def test_frequency_polymer_never_analysed_has_zero_denominator():
    f = quantification_frequency([rec(status=S.not_analysed, value=None)])
    assert [(x.polymer, x.matrix, x.n_quantified, x.n_samples, x.fraction) for x in f] == [
        ("PET", Matrix.whole_blood, 0, 0, 0.0), ("ANY", Matrix.whole_blood, 0, 0, 0.0)]


def test_aggregate_never_pools_matrices():
    recs = [rec(aliquot="a", value=1.0), replace(rec(aliquot="b", value=3.0), matrix=Matrix.plasma)]
    out = aggregate_aliquots(recs)
    assert [(s.matrix, s.value) for s in out] == [(Matrix.plasma, 3.0), (Matrix.whole_blood, 1.0)]


# ---- residuals ----


def rec_x(matrix, **kw):
    return replace(rec(**kw), matrix=matrix)


def test_describe_never_pools_matrices():
    recs = [rec_x(Matrix.plasma, sample="P1", value=0.5), rec_x(Matrix.plasma, sample="P2", value=0.7),
            rec_x(Matrix.whole_blood, sample="W1", value=5.0),
            rec_x(Matrix.whole_blood, sample="W2", status=S.below_lod, value=None)]
    stats = describe(recs)
    assert [(s.polymer, s.method, s.matrix, s.n_quantified, s.min, s.max) for s in stats] == [
        ("PET", "M", Matrix.plasma, 2, 0.5, 0.7), ("PET", "M", Matrix.whole_blood, 1, 5.0, 5.0)]
    assert [sum(s.counts_by_status.values()) for s in stats] == [2, 2]
    assert [f.name for f in fields(PolymerStats)][:3] == ["polymer", "method", "matrix"]


def test_frequency_per_polymer_and_matrix_with_any_per_matrix():
    recs = [rec_x(Matrix.plasma, sample="P1"), rec_x(Matrix.plasma, sample="P2", status=S.below_lod,
                                                   value=None),
            rec_x(Matrix.plasma, sample="P2", polymer="PE"),
            rec_x(Matrix.whole_blood, sample="W1", status=S.below_lod, value=None),
            rec_x(Matrix.whole_blood, sample="W2", polymer="PE", status=S.not_analysed, value=None),
            rec_x(Matrix.serum, sample="R1", polymer="PE", status=S.below_lod, value=None)]
    got = [(f.polymer, f.matrix, f.n_quantified, f.n_samples) for f in quantification_frequency(recs)]
    assert got == [
        ("PE", Matrix.plasma, 1, 1), ("PE", Matrix.serum, 0, 1), ("PE", Matrix.whole_blood, 0, 0),
        ("PET", Matrix.plasma, 1, 2), ("PET", Matrix.whole_blood, 0, 1),
        ("ANY", Matrix.plasma, 2, 2), ("ANY", Matrix.serum, 0, 1),
        ("ANY", Matrix.whole_blood, 0, 1)]
    assert [f.name for f in fields(Frequency)][:2] == ["polymer", "matrix"]


def test_plasma_and_whole_blood_donors_in_one_import_stay_apart():
    cols = ["Sample", "Matrix", "Polymer", "Value"]
    data = [["P1", "plasma", "PET", "0,5"], ["P2", "plasma", "PET", "0,6"],
            ["W1", "sang total", "PET", "5"], ["W2", "sang total", "PET", "<LOD"]]
    t = RawTable(tuple(cols), tuple(dict(zip(cols, r, strict=True)) for r in data),
                 (2, 3, 4, 5), "simulated.csv", None)
    m = Mapping("long", {"sample_id": "Sample", "matrix": "Matrix", "polymer": "Polymer",
                         "reported_value": "Value"}, constants={"unit": "µg/mL", "method": "Py-GC/MS"})
    r = run_import(t, m, leslie_like_context())
    assert not r.has_errors
    assert [(s.matrix, s.n_quantified, s.median, s.max) for s in describe(r.records)] == [
        (Matrix.plasma, 2, pytest.approx(0.55), 0.6), (Matrix.whole_blood, 1, 5.0, 5.0)]
    assert [(f.polymer, f.matrix, f.n_quantified, f.n_samples)
            for f in quantification_frequency(r.records)] == [
        ("PET", Matrix.plasma, 2, 2), ("PET", Matrix.whole_blood, 1, 2),
        ("ANY", Matrix.plasma, 2, 2), ("ANY", Matrix.whole_blood, 1, 2)]
