"""Row validation tests (all data is synthetic, simulated)."""
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


def row(number=2, col="Valeur", **over):
    fields = {**BASE, **over}
    return MappedRow({k: v for k, v in fields.items() if v is not None}, number, col)


def run(*rows, context=None):
    return validate_rows(list(rows), context or ctx())


def only(issues, code):
    found = [i for i in issues if i.code == code]
    assert len(found) == 1, issues
    return found[0]


def check(issues, code, severity, column, number=2):
    i = only(issues, code)
    assert (i.severity, i.row, i.column) == (severity, number, column)
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
    check(issues, "E_MATRIX_DETAIL_MISSING", "error", "matrix_detail")


def test_e_unknown_method():
    _, issues = run(row(method="Mystère"))
    check(issues, "E_UNKNOWN_METHOD", "error", "method")


def test_e_unknown_unit():
    _, issues = run(row(unit="furlongs"))
    check(issues, "E_UNKNOWN_UNIT", "error", "unit")


def test_e_unparsable_value():
    recs, issues = run(row(reported_value="beaucoup"))
    assert recs == []
    check(issues, "E_UNPARSABLE_VALUE", "error", "Valeur")


def test_e_negative_value():
    _, issues = run(row(reported_value="-1"))
    check(issues, "E_NEGATIVE_VALUE", "error", "Valeur")


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
    check(issues, "E_LIMIT_UNIT_MISMATCH", "error", "lod")


def test_e_lod_gt_loq():
    _, issues = run(row(lod="0,5", loq="0,2"))
    check(issues, "E_LOD_GT_LOQ", "error", "lod")


def test_w_limit_conflict():
    recs, issues = run(row(lod="0,2", loq="0,43"))
    check(issues, "W_LIMIT_CONFLICT", "warning", "lod")
    assert recs[0].lod == 0.2


def test_w_no_limits():
    recs, issues = run(row(), context=ctx(limits=()))
    check(issues, "W_NO_LIMITS", "warning", "Valeur")
    assert recs[0].status is DetectionStatus.quantified


def test_w_no_limits_bound_is_not_quantified():
    recs, issues = run(row(reported_value="< 0,5"), context=ctx(limits=()))
    check(issues, "W_NO_LIMITS", "warning", "Valeur")
    assert recs[0].status is DetectionStatus.not_quantified and recs[0].value is None


def test_e_status_value_conflict():
    recs, issues = run(row(detection_status="below_lod"))
    assert recs == []
    check(issues, "E_STATUS_VALUE_CONFLICT", "error", "Valeur")


def test_w_status_inconsistent_keeps_declared():
    recs, issues = run(row(reported_value="0,3", detection_status="quantified"))
    check(issues, "W_STATUS_INCONSISTENT", "warning", "Valeur")
    assert recs[0].status is DetectionStatus.quantified


def test_w_status_inconsistent_bound_above_loq():
    recs, issues = run(row(reported_value="<1"))
    check(issues, "W_STATUS_INCONSISTENT", "warning", "Valeur")
    assert recs[0].status is DetectionStatus.not_quantified


def test_w_status_inconsistent_star_outside_interval():
    recs, issues = run(row(reported_value="*2"))
    check(issues, "W_STATUS_INCONSISTENT", "warning", "Valeur")
    assert recs[0].status is DetectionStatus.between_lod_loq


def test_w_value_below_lod():
    recs, issues = run(row(reported_value="0,05"))
    check(issues, "W_VALUE_BELOW_LOD", "warning", "Valeur")
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
