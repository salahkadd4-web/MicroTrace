"""Import orchestrator tests (all tables are synthetic, simulated / fictif)."""
from dataclasses import replace

import pytest

from microtrace_core.results.importer import RULES_VERSION, run_import
from microtrace_core.results.mapping import Mapping, suggest_mapping
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
    assert result.rules_version == RULES_VERSION == "2"
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
    assert (got.severity, got.row, got.field, got.column) == ("error", 2, "unit", None)

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
    assert {(i.severity, i.field, i.column) for i in got} == {("error", "lod", None)}
    assert got[0].row == 2

    # duplicated 3a row (appended at spreadsheet row 42)
    assert base.rows[4]["Donor"] == "3a"
    dup = replace(base, rows=(*base.rows, dict(base.rows[4])), row_numbers=(*base.row_numbers, 42))
    res = run_import(dup, leslie_like_mapping(), ctx)
    assert _err_codes(res) == {"E_DUPLICATE_RECORD"}
    got = _find(res, "E_DUPLICATE_RECORD")
    assert {(i.severity, i.row, i.field, i.column) for i in got} == {
        ("error", 42, "sample_id", "Donor")}
    assert len(got) == 5


def test_traps_needing_per_cell_columns_use_long_variant():
    ctx = leslie_like_context()
    # declared status <LOD with a numeric value
    t = _long(["Sample", "Polymer", "Value", "Status"], [["1", "PET", "1.2", "<LOD"]])
    r = run_import(t, _long_mapping(detection_status="Status"), ctx)
    assert _err_codes(r) == {"E_STATUS_VALUE_CONFLICT"}
    got = _find(r, "E_STATUS_VALUE_CONFLICT")[0]
    assert (got.severity, got.row, got.field, got.column) == (
        "error", 2, "reported_value", "Value")
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
    assert {dl.unit_code for dl in leslie_like_context().limits} == {"ug/mL"}


# ---- final review ----

_PII_CODES = {"E_PII_COLUMN", "E_PII_VALUE", "W_POSSIBLE_PII_COLUMN", "W_POSSIBLE_BIRTHDATE"}


def test_pii_errors_stop_before_validation_and_never_echo_values():
    secrets = ("06 12 34 56 78", "jean.dupont@chu.fr", "Jean Dupont")
    t = _long(["Sample", "Polymer", "Value", "Code patient"], [
        ["06 12 34 56 78", "Jean Dupont", "jean.dupont@chu.fr", "Jean Dupont"],
        ["06 12 34 56 78", "PET", "06 12 34 56 78", "jean.dupont@chu.fr"],
        ["S3", "jean.dupont@chu.fr", "Jean Dupont", "P003"],
    ])
    m = Mapping("long", {"sample_id": "Sample", "polymer": "Polymer", "reported_value": "Value"},
                constants={"matrix": "sang total", "unit": UG_ML, "method": PYGC},
                split_aliquot_suffix=True)
    r = run_import(t, m, leslie_like_context())
    assert r.has_errors and r.records == () and r.qc_records == ()
    assert any(i.code == "E_PII_VALUE" for i in r.issues)
    for i in r.issues:
        assert not any(s in i.message for s in secrets), i
        assert i.code in _PII_CODES or i.code.startswith("E_MAPPING")



def test_leslie_like_has_no_unmapped_or_split_warnings():
    r = run_import(leslie_like_wide_table(), leslie_like_mapping(), leslie_like_context())
    codes = {i.code for i in r.issues}
    assert not codes & {"I_UNMAPPED_COLUMN", "W_ALIQUOT_SPLIT_FAILED", "E_SAMPLE_CONFLICT"}


# ---- residuals ----

def _ctx():
    return replace(leslie_like_context(), limits=())


def _csv_table(lines):
    rows = [ln.split(";") for ln in lines[1:]]
    return _long(lines[0].split(";"), rows)


def test_header_unit_conflicts_with_unit_column():
    t = _csv_table(["Sample ID;Matrix;Method;Unit;PET (ng/mL);PE (ng/mL)",
                    f"S1;plasma;{PYGC};µg/mL;500;400", f"S2;plasma;{PYGC};µg/mL;300;200"])
    m = suggest_mapping(t)
    assert m.field_columns["unit"] == "Unit" and m.constants == {}
    r = run_import(t, m, _ctx())
    got = [(i.row, i.column, i.field) for i in r.issues if i.code == "E_HEADER_UNIT_CONFLICT"]
    assert got == [(2, "PET (ng/mL)", "unit"), (2, "PE (ng/mL)", "unit"),
                   (3, "PET (ng/mL)", "unit"), (3, "PE (ng/mL)", "unit")]
    assert r.records == () and r.has_errors


def test_header_unit_becomes_the_unit_constant():
    t = _csv_table(["Sample ID;Matrix;Method;PET (ng/mL);PE (ng/mL)",
                    f"S1;plasma;{PYGC};500;43", f"S2;plasma;{PYGC};9;1200"])
    m = suggest_mapping(t)
    assert m.constants == {"unit": "ng/mL"}
    r = run_import(t, m, _ctx())
    assert not r.has_errors
    assert not any("HEADER" in i.code for i in r.issues)
    got = [(x.sample_id, x.polymer, x.value, x.unit.code, x.canonical_value,
            x.canonical_unit.code) for x in r.records]
    assert got == [("S1", "PET", 500.0, "ng/mL", 0.5, "ug/mL"),
                   ("S1", "PE", 43.0, "ng/mL", 0.043, "ug/mL"),
                   ("S2", "PET", 9.0, "ng/mL", 0.009, "ug/mL"),
                   ("S2", "PE", 1200.0, "ng/mL", 1.2, "ug/mL")]


def test_mixed_header_units_suggest_no_constant():
    t = _csv_table(["Sample ID;Matrix;Method;PET (ng/mL);PE (µg/mL)",
                    f"S1;plasma;{PYGC};500;0,4"])
    m = suggest_mapping(t)
    assert m.mode == "wide" and "unit" not in m.constants and "unit" not in m.field_columns
    r = run_import(t, m, _ctx())
    assert {i.code for i in r.issues if i.severity == "error"} == {"E_REQUIRED_MISSING"}


_CONTACT_HEADERS = ("jean.dupont@chu.fr", "06 12 34 56 78")


@pytest.mark.parametrize("split", [False, True])
def test_contact_headers_flagged_by_position_and_never_echoed(split):
    t = _csv_table([f"Sample ID;Matrix;Method;Unit;PET;PE;{_CONTACT_HEADERS[0]};"
                    f"{_CONTACT_HEADERS[1]};Notes",
                    f"S1;plasma;{PYGC};µg/mL;0,5;0,4;x;y;z"])
    m = replace(suggest_mapping(t), split_aliquot_suffix=split)
    r = run_import(t, m, _ctx())
    assert r.has_errors and r.records == () and r.qc_records == ()
    pii = [i for i in r.issues if i.code == "E_PII_COLUMN"]
    assert [(i.severity, i.row, i.column) for i in pii] == [("error", None, None)] * 2
    assert "colonne n° 7" in pii[0].message and "colonne n° 8" in pii[1].message
    for i in r.issues:
        assert not any(s in i.message or s in (i.column or "") for s in _CONTACT_HEADERS), i
        assert i.code != "I_UNMAPPED_COLUMN"


def test_contact_header_mapped_to_a_field_never_echoed():
    t = _csv_table([f"{_CONTACT_HEADERS[0]};Polymer;Value;{_CONTACT_HEADERS[1]}",
                    "S1;PET;0,5;x"])
    m = Mapping("long", {"sample_id": _CONTACT_HEADERS[0], "polymer": "Polymer",
                         "reported_value": "Value", "zorg": _CONTACT_HEADERS[1]},
                constants={"matrix": "plasma", "unit": UG_ML, "method": PYGC})
    r = run_import(t, m, _ctx())
    assert r.has_errors and r.records == ()
    assert {i.code for i in r.issues} >= {"E_PII_COLUMN"}
    for i in r.issues:
        assert not any(s in i.message or s in (i.column or "") for s in _CONTACT_HEADERS), i
