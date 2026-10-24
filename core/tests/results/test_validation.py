"""Row validation tests (all data is synthetic, simulated)."""
import pytest

from microtrace_core.results.mapping import MappedRow
from microtrace_core.results.records import DetectionLimit, MethodSpec, StudyContext
from microtrace_core.results.validation import validate_rows
from microtrace_core.results.vocab import (
    DataNature,
    DetectionStatus,
    IdentificationStatus,
    Technique,
)

PYGC = "Py-GC/MS"

BASE = {
    "sample_id": "S1", "matrix": "sang total", "polymer": "PET", "reported_value": "2,4",
    "unit": "µg/mL", "method": PYGC,
}


def ctx(limits=None, methods=None):
    if limits is None:
        limits = (DetectionLimit(PYGC, "PET", 0.13, 0.43, "ug/mL", "simulated"),)
    methods = methods or (MethodSpec(PYGC, Technique.py_gc_ms),
                          MethodSpec("uFTIR", Technique.micro_ftir))
    return StudyContext(DataNature.simulated, tuple(methods), tuple(limits))


def unchecked_limit(**over):
    """A study limit that bypasses DetectionLimit validation (defensive paths only)."""
    dl = DetectionLimit(PYGC, "PET", 0.13, 0.43, "ug/mL", "simulated")
    for k, v in over.items():
        object.__setattr__(dl, k, v)
    return dl


def col(name):
    """File column of a field in ``row()``: the value column, else "[field]"."""
    return "Valeur" if name == "reported_value" else f"[{name}]"


def row(number=2, col="Valeur", **over):
    fields = {k: v for k, v in {**BASE, **over}.items() if v is not None}
    columns = {k: (col if k == "reported_value" else f"[{k}]") for k in fields}
    return MappedRow(fields, number, col, columns)


def run(*rows, context=None):
    return validate_rows(list(rows), context or ctx())


def only(issues, code):
    found = [i for i in issues if i.code == code]
    assert len(found) == 1, issues
    return found[0]


FROM_FIELD = object()


def check(issues, code, severity, field, number=2, column=FROM_FIELD):
    """``column`` defaults to the row's file column for ``field``; None = study context."""
    i = only(issues, code)
    expected = col(field) if column is FROM_FIELD else column
    assert (i.severity, i.row, i.field, i.column) == (severity, number, field, expected)
    assert i.message
    return i


def test_valid_long_row_builds_record():
    recs, issues = run(row())
    assert issues == []
    r = recs[0]
    assert r.status is DetectionStatus.quantified
    assert r.canonical_value == 2.4
    assert r.identification_status is IdentificationStatus.confirmed
    assert (r.lod, r.loq) == (0.13, 0.43)


def test_ng_per_ml_canonicalised():
    recs, _ = run(row(reported_value="500", unit="ng/mL"))
    r = recs[0]
    assert r.canonical_value == 0.5 and r.canonical_unit.code == "ug/mL" and r.value == 500


def test_star_value_between():
    recs, issues = run(row(reported_value="*0.3"))
    assert recs[0].status is DetectionStatus.between_lod_loq and recs[0].value == 0.3
    assert issues == []


def test_e_required_missing():
    recs, issues = run(row(sample_id=""))
    assert recs == []
    check(issues, "E_REQUIRED_MISSING", "error", "sample_id")


def test_e_unknown_matrix():
    recs, issues = run(row(matrix="urine"))
    assert recs == []
    check(issues, "E_UNKNOWN_MATRIX", "error", "matrix")


def test_e_matrix_detail_missing():
    _, issues = run(row(matrix="autre"))
    check(issues, "E_MATRIX_DETAIL_MISSING", "error", "matrix_detail", column=None)


def test_e_unknown_method():
    _, issues = run(row(method="Mystère"))
    check(issues, "E_UNKNOWN_METHOD", "error", "method")


def test_e_unknown_unit():
    _, issues = run(row(unit="furlongs"))
    check(issues, "E_UNKNOWN_UNIT", "error", "unit")


def test_e_unparsable_value():
    recs, issues = run(row(reported_value="beaucoup"))
    assert recs == []
    check(issues, "E_UNPARSABLE_VALUE", "error", "reported_value")


def test_e_negative_value():
    _, issues = run(row(reported_value="-1"))
    check(issues, "E_NEGATIVE_VALUE", "error", "reported_value")


def test_e_unknown_record_type():
    _, issues = run(row(record_type="mystère"))
    check(issues, "E_UNKNOWN_RECORD_TYPE", "error", "record_type")


def test_e_unknown_status():
    _, issues = run(row(detection_status="peut-être"))
    check(issues, "E_UNKNOWN_STATUS", "error", "detection_status")


def test_e_unknown_identification():
    _, issues = run(row(identification_status="sûr"))
    check(issues, "E_UNKNOWN_IDENTIFICATION", "error", "identification_status")


def test_e_polymer_missing():
    _, issues = run(row(polymer="/"))
    check(issues, "E_POLYMER_MISSING", "error", "polymer")


def test_w_polymer_other():
    recs, issues = run(row(polymer="polyzorglub"))
    check(issues, "W_POLYMER_OTHER", "warning", "polymer")
    assert recs[0].polymer == "OTHER" and recs[0].polymer_raw == "polyzorglub"


def test_i_ps_as_sum():
    recs, issues = run(row(polymer="PS"), context=ctx(limits=()))
    check(issues, "I_PS_AS_SUM", "info", "polymer")
    assert recs[0].polymer == "PS_SUM"


def test_e_limit_unit_mismatch():
    c = ctx(limits=(DetectionLimit(PYGC, "PET", 0.1, 0.4, "particles/mL", "simulated"),))
    recs, issues = run(row(), context=c)
    assert recs == []
    check(issues, "E_LIMIT_UNIT_MISMATCH", "error", "lod", column=None)


def test_e_lod_gt_loq():
    _, issues = run(row(lod="0,5", loq="0,2"))
    check(issues, "E_LOD_GT_LOQ", "error", "lod")


def test_w_limit_conflict():
    recs, issues = run(row(lod="0,2", loq="0,43"))
    check(issues, "W_LIMIT_CONFLICT", "warning", "lod")
    assert recs[0].lod == 0.2


def test_w_no_limits():
    recs, issues = run(row(), context=ctx(limits=()))
    check(issues, "W_NO_LIMITS", "warning", "reported_value")
    assert recs[0].status is DetectionStatus.quantified


def test_w_no_limits_bound_is_not_quantified():
    recs, issues = run(row(reported_value="< 0,5"), context=ctx(limits=()))
    check(issues, "W_NO_LIMITS", "warning", "reported_value")
    assert recs[0].status is DetectionStatus.not_quantified and recs[0].value is None


def test_e_status_value_conflict():
    recs, issues = run(row(detection_status="below_lod"))
    assert recs == []
    check(issues, "E_STATUS_VALUE_CONFLICT", "error", "reported_value")


def test_w_status_inconsistent():
    recs, issues = run(row(reported_value="0,3", detection_status="quantified"))
    check(issues, "W_STATUS_INCONSISTENT", "warning", "reported_value")
    assert recs[0].status is DetectionStatus.quantified


def test_w_status_inconsistent_bound_above_loq():
    recs, issues = run(row(reported_value="<1"))
    check(issues, "W_STATUS_INCONSISTENT", "warning", "reported_value")
    assert recs[0].status is DetectionStatus.not_quantified


def test_w_status_inconsistent_star_outside_interval():
    recs, issues = run(row(reported_value="*2"))
    check(issues, "W_STATUS_INCONSISTENT", "warning", "reported_value")
    assert recs[0].status is DetectionStatus.between_lod_loq


def test_w_value_below_lod():
    recs, issues = run(row(reported_value="0,05"))
    check(issues, "W_VALUE_BELOW_LOD", "warning", "reported_value")
    r = recs[0]
    assert r.status is DetectionStatus.below_lod and r.value is None
    assert r.reported_value == "0,05" and r.canonical_value is None


def test_e_duplicate_record():
    recs, issues = run(row(2), row(3))
    assert len(recs) == 1
    check(issues, "E_DUPLICATE_RECORD", "error", "sample_id", number=3)


def test_empty_value_is_not_analysed_without_error():
    recs, issues = run(row(reported_value=""))
    assert issues == []
    assert recs[0].status is DetectionStatus.not_analysed and recs[0].value is None


def test_info_does_not_block_and_wide_column_reported():
    recs, issues = run(row(polymer="PS", col="PS"), context=ctx(limits=()))
    assert len(recs) == 1 and recs[0].source_column == "PS"
    assert {i.code for i in issues} == {"I_PS_AS_SUM", "W_NO_LIMITS"}
    assert only(issues, "W_NO_LIMITS").column == "PS"


def test_row_limit_unreadable():
    _, issues = run(row(lod="abc"))
    check(issues, "E_UNPARSABLE_VALUE", "error", "lod")


def test_size_unreadable():
    _, issues = run(row(size_min_um="petit"))
    check(issues, "E_UNPARSABLE_VALUE", "error", "size_min_um")


def test_table_limit_converted_to_row_unit():
    c = ctx(limits=(DetectionLimit(PYGC, "PET", 0.13, 0.43, "ug/mL", "simulated"),))
    recs, _ = run(row(reported_value="500", unit="ng/mL"), context=c)
    assert (recs[0].lod, recs[0].loq) == (130.0, 430.0)
    assert recs[0].status is DetectionStatus.quantified


# ---- fix round 1 ----


@pytest.mark.parametrize("declared", ["quantified", "between_lod_loq"])
@pytest.mark.parametrize("rep", ["<0,5", "nd", "<LOD", ""])
@pytest.mark.parametrize("limits", [None, ()])
def test_e_status_value_conflict_declared_quantified_without_value(declared, rep, limits):
    recs, issues = run(row(reported_value=rep, detection_status=declared),
                       context=ctx(limits=limits))
    assert recs == []
    check(issues, "E_STATUS_VALUE_CONFLICT", "error", "reported_value")


def test_partial_loq_only_not_quantified():
    c = ctx(limits=(DetectionLimit(PYGC, "PET", None, 0.43, "ug/mL", "simulated"),))
    recs, issues = run(row(reported_value="0,2"), context=c)
    assert recs[0].status is DetectionStatus.not_quantified
    i = check(issues, "W_NO_LIMITS", "warning", "reported_value")
    assert "LOD absente" in i.message and "valeur non conservée" in i.message
    assert recs[0].value is None


@pytest.mark.parametrize("declared", ["between_lod_loq", "below_lod"])
def test_loq_only_declared_compatible_no_inconsistency(declared):
    c = ctx(limits=(DetectionLimit(PYGC, "PET", None, 0.43, "ug/mL", "simulated"),))
    _, issues = run(row(reported_value="0,2" if declared == "between_lod_loq" else "<0,2",
                        detection_status=declared), context=c)
    assert not [i for i in issues if i.code == "W_STATUS_INCONSISTENT"]


def test_bad_unit_entry_does_not_block_later_valid_entry():
    c = ctx(limits=(DetectionLimit(PYGC, "PET", 0.1, 0.4, "particles/mL", "simulated"),
                    DetectionLimit(PYGC, "PET", 0.13, 0.43, "ug/mL", "simulated")))
    recs, issues = run(row(), context=c)
    check(issues, "E_LIMIT_UNIT_MISMATCH", "error", "lod", column=None)
    assert not [i for i in issues if i.code in ("W_LIMIT_CONFLICT", "W_NO_LIMITS")]


def test_no_w_no_limits_when_unit_mismatch_raised():
    c = ctx(limits=(DetectionLimit(PYGC, "PET", 0.1, 0.4, "particles/mL", "simulated"),))
    _, issues = run(row(), context=c)
    assert {i.code for i in issues} == {"E_LIMIT_UNIT_MISMATCH"}


def test_declared_quantified_below_lone_loq_inconsistent():
    c = ctx(limits=(DetectionLimit(PYGC, "PET", None, 0.43, "ug/mL", "simulated"),))
    recs, issues = run(row(reported_value="0,2", detection_status="quantified"), context=c)
    check(issues, "W_STATUS_INCONSISTENT", "warning", "reported_value")
    assert recs[0].status is DetectionStatus.quantified


def test_lod_only_value_above_warns_loq_missing():
    c = ctx(limits=(DetectionLimit(PYGC, "PET", 0.13, None, "ug/mL", "simulated"),))
    recs, issues = run(row(), context=c)
    i = check(issues, "W_NO_LIMITS", "warning", "reported_value")
    assert "LOQ" in i.message and recs[0].status is DetectionStatus.quantified


def test_ps_and_ps_sum_duplicate():
    _, issues = run(row(2, polymer="PS"), row(3, polymer="PS_SUM"), context=ctx(limits=()))
    check(issues, "E_DUPLICATE_RECORD", "error", "sample_id", number=3)


def test_ps_sum_limit_applies_to_ps_row():
    c = ctx(limits=(DetectionLimit(PYGC, "PS_SUM", 0.1, 0.4, "ug/mL", "simulated"),))
    recs, _ = run(row(polymer="PS"), context=c)
    assert (recs[0].lod, recs[0].loq) == (0.1, 0.4)


def test_other_polymers_distinct_keys():
    recs, issues = run(row(2, polymer="polyfoo"), row(3, polymer="polybar"))
    assert len(recs) == 2 and not [i for i in issues if i.code == "E_DUPLICATE_RECORD"]
    _, issues = run(row(2, polymer="polyfoo"), row(3, polymer="PolyFoo"))
    check(issues, "E_DUPLICATE_RECORD", "error", "sample_id", number=3)


def test_negative_table_limit():
    c = ctx(limits=(unchecked_limit(lod=-0.1, loq=0.4),))
    _, issues = run(row(), context=c)
    check(issues, "E_NEGATIVE_VALUE", "error", "lod", column=None)


def test_e_lod_gt_loq_from_table_even_if_row_overrides():
    c = ctx(limits=(DetectionLimit(PYGC, "PET", 0.5, 0.2, "ug/mL", "simulated"),))
    _, issues = run(row(lod="0,1", loq="0,4"), context=c)
    check(issues, "E_LOD_GT_LOQ", "error", "lod", column=None)


def test_e_lod_gt_loq_from_table():
    c = ctx(limits=(DetectionLimit(PYGC, "PET", 0.5, 0.2, "ug/mL", "simulated"),))
    _, issues = run(row(), context=c)
    check(issues, "E_LOD_GT_LOQ", "error", "lod", column=None)


def test_w_limit_conflict_between_table_entries():
    c = ctx(limits=(DetectionLimit(PYGC, "PET", 0.13, 0.43, "ug/mL", "simulated"),
                    DetectionLimit(PYGC, "PET", 0.2, 0.43, "ug/mL", "simulated")))
    recs, issues = run(row(), context=c)
    i = check(issues, "W_LIMIT_CONFLICT", "warning", "lod", column=None)
    assert recs[0].lod == 0.13 and "première" in i.message


def test_negative_size():
    _, issues = run(row(size_max_um="-3"))
    check(issues, "E_NEGATIVE_VALUE", "error", "size_max_um")


def test_negative_row_lod():
    _, issues = run(row(lod="-0,1"))
    check(issues, "E_NEGATIVE_VALUE", "error", "lod")


def test_negative_bound():
    _, issues = run(row(reported_value="<-1"))
    check(issues, "E_NEGATIVE_VALUE", "error", "reported_value")


def test_unknown_table_unit_message():
    c = ctx(limits=(unchecked_limit(lod=0.1, loq=0.4, unit_code="furlongs"),))
    _, issues = run(row(), context=c)
    assert "unité inconnue" in check(issues, "E_LIMIT_UNIT_MISMATCH", "error", "lod", column=None).message


def test_identification_default_and_override():
    recs, _ = run(row(method="uFTIR"))
    assert recs[0].identification_status is IdentificationStatus.confirmed
    c = ctx(methods=(MethodSpec("X", Technique.other),))
    recs, _ = run(row(method="X"), context=c)
    assert recs[0].identification_status is IdentificationStatus.candidate
    recs, _ = run(row(method="X", identification_status="confirmed"), context=c)
    assert recs[0].identification_status is IdentificationStatus.confirmed


def test_declared_status_on_bound_path():
    recs, issues = run(row(reported_value="<0,5", detection_status="below_lod"))
    assert recs[0].status is DetectionStatus.below_lod
    check(issues, "W_STATUS_INCONSISTENT", "warning", "reported_value")


# ---- final review ----


def test_e_sample_conflict_one_issue_per_sample():
    recs, issues = run(
        row(2, aliquot="a"), row(3, aliquot="b", matrix="plasma"),
        row(4, sample_id="S2"), row(5, sample_id="S2", polymer="PE", record_type="procedural_blank"),
        row(6, sample_id="S3", polymer="PE", matrix="sérum", record_type="field_blank"),
        row(7, sample_id="S3", matrix="sang total"),
        row(8, sample_id="S4"), row(9, sample_id="S4", polymer="PE"))
    got = [i for i in issues if i.code == "E_SAMPLE_CONFLICT"]
    assert [(i.severity, i.row, i.field, i.column) for i in got] == [
        ("error", None, "sample_id", "[sample_id]")] * 3
    assert "S1" in got[0].message and "2, 3" in got[0].message and "matrice" in got[0].message
    assert "S2" in got[1].message and "4, 5" in got[1].message and "type" in got[1].message
    assert "S3" in got[2].message and "matrice" in got[2].message and "type" in got[2].message
    assert not any("S4" in i.message for i in issues)
