"""Honest aggregation, frequencies and statistics (all data simulated)."""
from __future__ import annotations

import pytest

from microtrace_core.results.importer import run_import
from microtrace_core.results.records import MeasurementRecord
from microtrace_core.results.summary import (
    AGGREGATION_RULE_FR,
    aggregate_aliquots,
    describe,
    quantification_frequency,
)
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
        identification_status=IdentificationStatus.confirmed, size_min_um=None,
        size_max_um=None, analysis_date="", batch="", lab="", comment="",
        source_row=2, source_column=polymer,
    )


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
    assert [f.polymer for f in quantification_frequency([])] == ["ANY"]
    assert quantification_frequency([])[0].fraction == 0.0


def test_leslie_like_frequencies_and_maxima():
    table = leslie_like_wide_table()
    result = run_import(table, leslie_like_mapping(table), leslie_like_context())
    freq = {f.polymer: (f.n_quantified, f.n_samples)
            for f in quantification_frequency(result.records)}
    assert freq == {"PET": (11, 22), "PS_SUM": (8, 22), "PE": (5, 22),
                    "PMMA": (1, 22), "PP": (0, 22), "ANY": (17, 22)}
    stats = {s.polymer: s for s in describe(result.records)}
    assert stats["PET"].max_measurement == pytest.approx(2.4)
    assert stats["PS_SUM"].max_measurement == pytest.approx(4.8)
    assert stats["PE"].max_measurement == pytest.approx(7.1)
    assert stats["PP"].n_quantified == 0 and stats["PP"].median is None
