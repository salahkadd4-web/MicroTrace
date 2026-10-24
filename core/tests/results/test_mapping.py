"""Column mapping tests (all tables are synthetic, simulated)."""
import time

import pytest

from microtrace_core.results.issues import Issue, has_errors
from microtrace_core.results.mapping import MappedRow, Mapping, apply_mapping, suggest_mapping
from microtrace_core.results.tables import RawTable


def _table(columns, rows, numbers=None):
    rows = tuple(dict(zip(columns, r, strict=True)) for r in rows)
    return RawTable(tuple(columns), rows, tuple(numbers or range(2, 2 + len(rows))), "simulated.csv", None)


def test_suggest_long():
    t = _table(["Donneur", "Aliquote", "Polymère", "Valeur", "Unité"], [["1", "a", "PE", "0,3", "µg/mL"]])
    m = suggest_mapping(t)
    assert m.mode == "long"
    assert m.field_columns == {"sample_id": "Donneur", "aliquot": "Aliquote", "polymer": "Polymère",
                               "reported_value": "Valeur", "unit": "Unité"}


def test_suggest_wide():
    cols = ["Donor", "PMMA", "PP", "PS", "PE", "PET"]
    m = suggest_mapping(_table(cols, [["1", "0", "0", "0", "0", "0"]]))
    assert m.mode == "wide"
    assert m.field_columns == {"sample_id": "Donor"}
    assert list(m.polymer_columns) == cols[1:]


def test_generic_id_only_when_no_specific():
    m = suggest_mapping(_table(["id", "Donneur", "value"], [["1", "2", "3"]]))
    assert m.field_columns["sample_id"] == "Donneur"
    assert suggest_mapping(_table(["ID", "value"], [["1", "2"]])).field_columns["sample_id"] == "ID"


def test_apply_wide_unpivots_with_constants():
    cols = ["Donor", "PMMA", "PP", "PS", "PE", "PET"]
    t = _table(cols, [["1", "1", "2", "3", "4", ""], ["2", "5", "6", "7", "8", "9"]], [2, 5])
    m = suggest_mapping(t)
    m = Mapping(m.mode, m.field_columns, m.polymer_columns, {"unit": "µg/mL", "matrix": "sang total"})
    rows, issues = apply_mapping(t, m)
    assert issues == [] and len(rows) == 10
    pet = [r for r in rows if r.source_column == "PET"]
    assert [r.source_row for r in pet] == [2, 5]
    assert pet[0].fields["unit"] == "µg/mL" and pet[0].fields["reported_value"] == ""
    assert pet[0].fields["polymer"] == "PET" and pet[0].fields["sample_id"] == "1"
    assert "aliquot" not in pet[0].fields


def test_apply_split_aliquot_suffix():
    t = _table(["Donor", "Valeur"], [["12a", "1"], ["7", "2"]])
    m = Mapping("long", {"sample_id": "Donor", "reported_value": "Valeur"}, split_aliquot_suffix=True)
    rows, _ = apply_mapping(t, m)
    assert [(r.fields["sample_id"], r.fields["aliquot"]) for r in rows] == [("12", "a"), ("7", "")]
    assert rows[0] == MappedRow(rows[0].fields, 2, "Valeur",
                                {"sample_id": "Donor", "aliquot": "Donor", "reported_value": "Valeur"})


def test_split_skipped_when_aliquot_mapped():
    t = _table(["Donor", "Aliq"], [["12a", "z"]])
    m = Mapping("long", {"sample_id": "Donor", "aliquot": "Aliq"}, split_aliquot_suffix=True)
    rows, _ = apply_mapping(t, m)
    assert rows[0].fields["sample_id"] == "12a" and rows[0].fields["aliquot"] == "z"


def test_apply_conflict_and_unknown_column():
    t = _table(["Donor", "Unit"], [["1", "x"]])
    m = Mapping("long", {"sample_id": "Donor", "unit": "Unit"}, constants={"unit": "ng/mL"})
    _, issues = apply_mapping(t, m)
    assert [i.code for i in issues] == ["E_MAPPING_CONFLICT"] and issues[0].severity == "error"
    _, issues = apply_mapping(t, Mapping("long", {"sample_id": "Nope"}))
    assert [i.code for i in issues] == ["E_MAPPING_UNKNOWN_COLUMN"] and has_errors(issues)


def test_wide_rejects_value_column():
    t = _table(["Donor", "PE", "PP", "V"], [["1", "1", "2", "3"]])
    m = Mapping("wide", {"sample_id": "Donor", "reported_value": "V"}, {"PE": "PE", "PP": "PP"})
    assert [i.code for i in apply_mapping(t, m)[1]] == ["E_MAPPING_CONFLICT"]


def test_has_errors():
    assert not has_errors([Issue("W", "warning", "m")])


def test_split_requires_digit_before_letter():
    t = _table(["Donor", "Valeur"], [["Control", "1"], ["blank", "2"], ["3b", "3"], ["a", "4"]])
    m = Mapping("long", {"sample_id": "Donor", "reported_value": "Valeur"}, split_aliquot_suffix=True)
    rows, issues = apply_mapping(t, m)
    assert [(r.fields["sample_id"], r.fields["aliquot"]) for r in rows] == [
        ("Control", ""), ("blank", ""), ("3", "b"), ("a", "")]
    assert [(i.code, i.severity) for i in issues] == [("W_ALIQUOT_SPLIT_FAILED", "warning")]


def test_wide_rejects_constant_polymer_or_value():
    t = _table(["Donor", "PE", "PP"], [["1", "1", "2"]])
    for name in ("polymer", "reported_value"):
        m = Mapping("wide", {"sample_id": "Donor"}, {"PE": "PE", "PP": "PP"}, {name: "x"})
        rows, issues = apply_mapping(t, m)
        assert rows == [] and [i.code for i in issues] == ["E_MAPPING_CONFLICT"]


# ---- final review ----


def test_wide_without_polymer_columns_has_its_own_code():
    t = _table(["Donor", "PE"], [["1", "1"]])
    _, issues = apply_mapping(t, Mapping("wide", {"sample_id": "Donor"}))
    assert [(i.code, i.field, i.column) for i in issues] == [
        ("E_MAPPING_NO_POLYMER_COLUMNS", "polymer", None)]


def test_mapping_issue_fields_and_columns():
    t = _table(["Donor", "Unit"], [["1", "x"]])
    m = Mapping("long", {"sample_id": "Donor", "unit": "Unit", "polymer": "Absent"},
                constants={"unit": "ng/mL"})
    got = {i.code: (i.field, i.column) for i in apply_mapping(t, m)[1]}
    assert got == {"E_MAPPING_CONFLICT": ("unit", "Unit"),
                   "E_MAPPING_UNKNOWN_COLUMN": ("polymer", None)}


def test_mapped_row_columns_long_and_wide():
    t = _table(["Donor", "PE", "PP"], [["1", "1", "2"]])
    rows, _ = apply_mapping(t, Mapping("wide", {"sample_id": "Donor"}, {"PE": "PE", "PP": "PP"},
                                       {"unit": "µg/mL"}))
    assert rows[1].columns == {"sample_id": "Donor", "polymer": "PP", "reported_value": "PP"}


@pytest.mark.parametrize("sid,base,aliquot", [
    ("2A", "2", "a"), ("D01-a", "D01", "a"), ("D01_B", "D01", "b"), ("12a", "12", "a"),
    ("MT-2021-3b", "MT-2021-3", "b")])
def test_split_aliquot_separators_and_case(sid, base, aliquot):
    t = _table(["Donor", "Valeur"], [[sid, "1"]])
    m = Mapping("long", {"sample_id": "Donor", "reported_value": "Valeur"}, split_aliquot_suffix=True)
    rows, issues = apply_mapping(t, m)
    assert (rows[0].fields["sample_id"], rows[0].fields["aliquot"]) == (base, aliquot)
    assert issues == []


def test_split_failures_reported_once_with_examples():
    ids = ["Control", "blank", "a", "7", "X1-", "Y", "Z", "3b", "", "Control"]
    t = _table(["Donor", "Valeur"], [[i, "1"] for i in ids])
    m = Mapping("long", {"sample_id": "Donor", "reported_value": "Valeur"}, split_aliquot_suffix=True)
    _, issues = apply_mapping(t, m)
    assert [(i.code, i.row, i.field, i.column) for i in issues] == [
        ("W_ALIQUOT_SPLIT_FAILED", None, "sample_id", "Donor")]
    msg = issues[0].message
    assert msg.startswith("7 ") and all(f"« {x} »" in msg for x in ["Control", "blank", "a", "7", "X1-"])
    assert "« Y »" not in msg and "« Z »" not in msg


def test_unmapped_columns_reported():
    t = _table(["Donor", "Valeur", "Notes", "PE", "PP"], [["1", "2", "x", "1", "2"]])
    _, issues = apply_mapping(t, Mapping("long", {"sample_id": "Donor", "reported_value": "Valeur"}))
    assert [(i.code, i.severity, i.column, i.field) for i in issues] == [
        ("I_UNMAPPED_COLUMN", "info", c, None) for c in ("Notes", "PE", "PP")]
    _, issues = apply_mapping(t, Mapping("wide", {"sample_id": "Donor"}, {"PE": "PE", "PP": "PP"},
                                         {"unit": "µg/mL"}))
    assert [i.column for i in issues] == ["Valeur", "Notes"]


def test_wide_headers_with_units_detected_and_stripped():
    t = _table(["Donor", "PET (µg/mL)", "PE [ng/mL]", "PMMA (lot 2)"], [["1", "1", "2", "3"]])
    m = suggest_mapping(t)
    assert m.mode == "wide"
    assert m.polymer_columns == {"PET (µg/mL)": "PET", "PE [ng/mL]": "PE"}
    rows, _ = apply_mapping(t, m)
    assert [(r.fields["polymer"], r.source_column) for r in rows] == [
        ("PET", "PET (µg/mL)"), ("PE", "PE [ng/mL]")]


# ---- residuals ----


def _timed_suggest(table):
    start = time.perf_counter()
    m = suggest_mapping(table)
    return m, time.perf_counter() - start


@pytest.mark.parametrize("header", ["(" + " " * 199_999, " " * 199_998 + "(x", "PET" + " (" * 99_998 + ")"],
                         ids=["paren-spaces", "spaces-paren", "space-paren-pairs"])
def test_unit_suffix_scan_is_linear_on_a_200k_header(header):
    assert len(header) >= 199_999
    m, elapsed = _timed_suggest(_table(["Donor", header], [["1", "1"]]))
    assert elapsed < 1.0
    assert m.polymer_columns == {}


def test_suggest_mapping_fast_on_500_columns_of_32k_headers():
    cols = [f"C{i:03d}(" + " " * 31_995 for i in range(500)]
    assert all(len(c) == 32_000 for c in cols)
    m, elapsed = _timed_suggest(_table(cols, [["1"] * 500]))
    assert elapsed < 1.0
    assert m.mode == "long" and m.field_columns == {}


def test_unit_suffix_stripping_unchanged_on_ordinary_headers():
    t = _table(["Donor", "PET (µg/mL)", "PE  [ng/mL]  ", "PP(mg/L)", "PS (sum)", "PMMA (lot 2)",
                "PVC (a)b)"], [["1"] * 7])
    assert suggest_mapping(t).polymer_columns == {
        "PET (µg/mL)": "PET", "PE  [ng/mL]  ": "PE", "PP(mg/L)": "PP"}


def test_same_header_unit_suggested_as_unit_constant():
    t = _table(["Donor", "PET (ng/mL)", "PE [ng/ml]", "PP (ng / mL)"], [["1", "1", "2", "3"]])
    m = suggest_mapping(t)
    assert m.mode == "wide" and m.constants == {"unit": "ng/mL"}
    rows, _ = apply_mapping(t, m)
    assert [(r.fields["unit"], r.header_unit) for r in rows] == [
        ("ng/mL", "ng/mL"), ("ng/mL", "ng/ml"), ("ng/mL", "ng / mL")]


@pytest.mark.parametrize("headers", [
    ["PET (ng/mL)", "PE (µg/mL)"], ["PET (ng/mL)", "PE"], ["PET (ng/mL)", "PE (ng/dL)"],
    ["PET (ug/mL)", "PE (mg/L)"]])
def test_no_unit_constant_when_header_units_differ_or_unknown(headers):
    t = _table(["Donor", *headers], [["1", "1", "2"]])
    m = suggest_mapping(t)
    assert m.mode == "wide" and list(m.polymer_columns) == headers
    assert m.constants == {}


def test_no_unit_constant_when_a_unit_column_exists():
    t = _table(["Donor", "Unité", "PET (ng/mL)", "PE (ng/mL)"], [["1", "µg/mL", "1", "2"]])
    m = suggest_mapping(t)
    assert m.field_columns["unit"] == "Unité" and m.constants == {}


def test_unit_shaped_unknown_header_is_stripped_but_others_kept():
    t = _table(["Donor", "PET (ng/dL)", "PE (items/100 mL)", "PS (sum)", "PMMA (lot 2)"],
               [["1"] * 5])
    m = suggest_mapping(t)
    assert m.polymer_columns == {"PET (ng/dL)": "PET", "PE (items/100 mL)": "PE"}
    rows, _ = apply_mapping(t, m)
    assert [r.header_unit for r in rows] == ["ng/dL", "items/100 mL"]


def test_header_unit_only_in_wide_mode():
    t = _table(["Donor", "Valeur (ng/mL)"], [["1", "2"]])
    rows, _ = apply_mapping(t, Mapping("long", {"sample_id": "Donor",
                                                "reported_value": "Valeur (ng/mL)"}))
    assert rows[0].header_unit is None
    t = _table(["Donor", "PET", "PE (sum)"], [["1", "2", "3"]])
    rows, _ = apply_mapping(t, Mapping("wide", {"sample_id": "Donor"},
                                       {"PET": "PET", "PE (sum)": "PE"}, {"unit": "µg/mL"}))
    assert [r.header_unit for r in rows] == [None, None]


# ---- long headers are never echoed; bracket groups that are not units ----


def _long_header():
    return "x" * 1075 + " contact jean.dupont@chu.fr"[:20] + "jean.dupont@chu.fr"


def _leaks(issues):
    return [i for i in issues if "jean.dupont" in i.message or (i.column and "jean.dupont" in i.column)]


def test_long_header_unmapped_column_named_by_position():
    h = _long_header()
    assert len(h) > 1000 and h.endswith("jean.dupont@chu.fr")
    t = _table(["Donor", "Valeur", h], [["1", "2", "x"]])
    _, issues = apply_mapping(t, Mapping("long", {"sample_id": "Donor", "reported_value": "Valeur"}))
    assert [(i.code, i.column) for i in issues] == [("I_UNMAPPED_COLUMN", None)]
    assert "colonne n° 3" in issues[0].message and not _leaks(issues)


def test_long_header_mapping_issues_never_echo_it():
    h = _long_header()
    t = _table(["Donor", h], [["1", "x"]])
    _, issues = apply_mapping(t, Mapping("long", {"bogus": h, "sample_id": "Donor"}))
    assert [i.code for i in issues] == ["E_MAPPING_UNKNOWN_FIELD"] and issues[0].column is None
    _, issues = apply_mapping(t, Mapping("long", {"sample_id": "Absent" + h}))
    assert [i.code for i in issues] == ["E_MAPPING_UNKNOWN_COLUMN"]
    _, issues = apply_mapping(t, Mapping("wide", {"sample_id": "Donor", "unit": h},
                                         {h + "z": "PET"}, {"unit": "µg/mL"}))
    assert issues and not _leaks(issues) and all(i.column is None for i in issues)


def test_long_header_run_import_never_echoes_it():
    from microtrace_core.results.importer import run_import

    from .conftest import leslie_like_context
    h = _long_header()
    t = _table(["Sample", "Polymer", "Value", h], [["S1", "PET", "1", "x"]])
    m = Mapping("long", {"sample_id": "Sample", "polymer": "Polymer", "reported_value": h})
    r = run_import(t, m, leslie_like_context())
    assert not _leaks(list(r.issues))


def test_bracket_groups_that_are_not_units():
    t = _table(["Donor", "PET (LOD/LOQ)", "PE (S/N)", "PP (sn)", "PS (µg/mL)", "PMMA (µg/mL)"],
               [["1", "1", "2", "3", "4", "5"]])
    m = suggest_mapping(t)
    assert set(m.polymer_columns) == {"PS (µg/mL)", "PMMA (µg/mL)"}
    _, issues = apply_mapping(t, m)
    assert sorted(i.column for i in issues if i.code == "I_UNMAPPED_COLUMN") == [
        "PE (S/N)", "PET (LOD/LOQ)", "PP (sn)"]


def test_technique_group_is_polymer_column_without_unit():
    t = _table(["Donor", "PET (Py-GC/MS)", "PE (Py-GC/MS)"], [["1", "1", "2"]])
    m = suggest_mapping(t)
    assert m.mode == "wide"
    assert m.polymer_columns == {"PET (Py-GC/MS)": "PET", "PE (Py-GC/MS)": "PE"}
    assert "unit" not in m.constants
