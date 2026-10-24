"""Import orchestrator tests (all tables are synthetic, simulated / fictif)."""
from dataclasses import replace

from microtrace_core.results.importer import RULES_VERSION, run_import
from microtrace_core.results.mapping import Mapping
from microtrace_core.results.tables import RawTable
from microtrace_core.results.vocab import DataNature, RecordType

from .conftest import (
    LESLIE_LIMITS,
    PYGC,
    UG_ML,
    leslie_like_context,
    leslie_like_mapping,
    leslie_like_wide_table,
    particles_context,
    particles_long_table,
    particles_mapping,
)


def _long(columns, rows):
    rs = tuple(dict(zip(columns, r, strict=True)) for r in rows)
    return RawTable(tuple(columns), rs, tuple(range(2, 2 + len(rs))), "simulated.csv", None)


def _long_mapping(**extra):
    fields = {"sample_id": "Sample", "polymer": "Polymer", "reported_value": "Value"}
    fields.update(extra)
    return Mapping("long", fields, constants={"matrix": "sang total", "unit": UG_ML, "method": PYGC})


def _find(result, code):
    found = [i for i in result.issues if i.code == code]
    assert found, [i.code for i in result.issues]
    return found


def _err_codes(result):
    return {i.code for i in result.issues if i.severity == "error"}


def _wide_with_column(name):
    t = leslie_like_wide_table()
    rows = tuple({**r, name: "x"} for r in t.rows)
    return replace(t, columns=(*t.columns, name), rows=rows)


def test_leslie_like_imports_clean():
    result = run_import(leslie_like_wide_table(), leslie_like_mapping(), leslie_like_context())
    assert result.rules_version == RULES_VERSION == "1"
    assert not [i for i in result.issues if i.severity == "error"]
    assert not result.has_errors
    assert any(i.code == "I_PS_AS_SUM" for i in result.issues)
    assert {r.polymer for r in result.records} == {"PMMA", "PP", "PS_SUM", "PE", "PET"}
    assert {r.aliquot for r in result.records} == {"a", "b"}
    assert result.qc_records == () and result.n_rows == 40 and len(result.records) == 200


def test_traps_each_produce_expected_issue():
    ctx, base = leslie_like_context(), leslie_like_wide_table()

    # unit ppm
    m = leslie_like_mapping()
    bad = Mapping(m.mode, m.field_columns, m.polymer_columns, {**m.constants, "unit": "ppm"}, True)
    res = run_import(base, bad, ctx)
    assert _err_codes(res) == {"E_UNKNOWN_UNIT"}
    got = _find(res, "E_UNKNOWN_UNIT")[0]
    assert (got.severity, got.row, got.column) == ("error", 2, "unit")

    # PII column
    t = _wide_with_column("Nom")
    res = run_import(t, leslie_like_mapping(t), ctx)
    assert _err_codes(res) == {"E_PII_COLUMN"}
    got = _find(res, "E_PII_COLUMN")
    assert [(i.severity, i.column) for i in got] == [("error", "Nom")]

    # LOD 0.5 > LOQ 0.43 for PET
    limits = tuple(replace(dl, lod=0.5) if dl.polymer == "PET" else dl for dl in ctx.limits)
    res = run_import(base, leslie_like_mapping(), replace(ctx, limits=limits))
    assert _err_codes(res) == {"E_LOD_GT_LOQ"}
    got = _find(res, "E_LOD_GT_LOQ")
    assert {(i.severity, i.column) for i in got} == {("error", "lod")}
    assert got[0].row == 2

    # duplicated 3a row (appended at spreadsheet row 42)
    assert base.rows[4]["Donor"] == "3a"
    dup = replace(base, rows=(*base.rows, dict(base.rows[4])), row_numbers=(*base.row_numbers, 42))
    res = run_import(dup, leslie_like_mapping(), ctx)
    assert _err_codes(res) == {"E_DUPLICATE_RECORD"}
    got = _find(res, "E_DUPLICATE_RECORD")
    assert {(i.severity, i.row, i.column) for i in got} == {("error", 42, "sample_id")}
    assert len(got) == 5


def test_traps_needing_per_cell_columns_use_long_variant():
    ctx = leslie_like_context()
    # declared status <LOD with a numeric value
    t = _long(["Sample", "Polymer", "Value", "Status"], [["1", "PET", "1.2", "<LOD"]])
    r = run_import(t, _long_mapping(detection_status="Status"), ctx)
    assert _err_codes(r) == {"E_STATUS_VALUE_CONFLICT"}
    got = _find(r, "E_STATUS_VALUE_CONFLICT")[0]
    assert (got.severity, got.row, got.column) == ("error", 2, "Value")
    assert r.has_errors and r.records == ()

    # a particles/mL row added to a mass table
    t = _long(["Sample", "Polymer", "Value", "Unit"],
              [["1", "PET", "1.2", UG_ML], ["2", "PET", "300", "particles/mL"]])
    m = Mapping("long", {"sample_id": "Sample", "polymer": "Polymer", "reported_value": "Value",
                         "unit": "Unit"}, constants={"matrix": "sang total", "method": PYGC})
    r = run_import(t, m, replace(ctx, limits=()))
    assert _err_codes(r) == set()
    mixed = _find(r, "W_MIXED_QUANTITY_KINDS")
    assert [(i.severity, i.row) for i in mixed] == [("warning", None)]
    assert not r.has_errors and len(r.records) == 2


def test_errors_block_all_records():
    ctx, base = leslie_like_context(), leslie_like_wide_table()
    t = _wide_with_column("Nom")
    r = run_import(t, leslie_like_mapping(t), ctx)
    assert r.has_errors and r.records == () and r.qc_records == ()
    ok = run_import(base, leslie_like_mapping(), ctx)
    assert ok.records and not ok.has_errors


def test_mapping_errors_stop_import_but_report_pii_too():
    t = _wide_with_column("Nom")
    m = leslie_like_mapping(t)
    bad = Mapping(m.mode, {**m.field_columns, "unit": "Absent"}, m.polymer_columns,
                  {k: v for k, v in m.constants.items() if k != "unit"}, True)
    r = run_import(t, bad, leslie_like_context())
    codes = {i.code for i in r.issues}
    assert {"E_PII_COLUMN", "E_MAPPING_UNKNOWN_COLUMN"} <= codes
    assert r.records == () and r.qc_records == () and r.has_errors
    assert not any(i.code.startswith(("E_UNKNOWN", "E_REQUIRED")) for i in r.issues)


def test_published_requires_reference():
    t = _long(["Sample", "Polymer", "Value"], [["1", "PET", "1.2"]])
    base = leslie_like_context()
    for doi, lic, bad in [(None, None, True), ("10.1/x", None, True), (None, "CC-BY", True),
                          ("10.1/x", "CC-BY", False)]:
        ctx = replace(base, data_nature=DataNature.published, reference_doi=doi,
                      reference_license=lic)
        r = run_import(t, _long_mapping(), ctx)
        codes = [i.code for i in r.issues]
        assert (codes.count("E_PUBLISHED_WITHOUT_REFERENCE") == 1) is bad
        assert r.has_errors is bad
        assert (r.records == ()) is bad


def test_qc_rows_separated():
    t = _long(["Sample", "Polymer", "Value", "Type"],
              [["1", "PET", "1.2", "sample"], ["B1", "PET", "<LOD", "procedural_blank"]])
    r = run_import(t, _long_mapping(record_type="Type"), leslie_like_context())
    assert not r.has_errors
    assert [x.sample_id for x in r.records] == ["1"]
    assert [(x.sample_id, x.record_type) for x in r.qc_records] == [("B1", RecordType.procedural_blank)]


def test_particles_long_imports_clean():
    r = run_import(particles_long_table(), particles_mapping(), particles_context())
    assert not r.has_errors and len(r.records) == 4
    assert not any(i.code == "W_MIXED_QUANTITY_KINDS" for i in r.issues)
    assert {x.unit.code for x in r.records} == {"particles/mL"}


def test_limits_table_is_table3():
    assert LESLIE_LIMITS["PET"] == (0.13, 0.43) and len(LESLIE_LIMITS) == 5
    assert {dl.unit_code for dl in leslie_like_context().limits} == {UG_ML}
