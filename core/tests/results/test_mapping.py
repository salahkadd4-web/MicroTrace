"""Column mapping tests (all tables are synthetic, simulated)."""
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
    assert rows[0] == MappedRow(rows[0].fields, 2, "Valeur")


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
