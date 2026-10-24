"""Personal-data detection tests (all tables are synthetic, simulated / fictif)."""
import pytest

from microtrace_core.results.mapping import Mapping
from microtrace_core.results.privacy import detect_pii
from microtrace_core.results.tables import RawTable


def _table(columns, rows, numbers=None):
    rows = tuple(dict(zip(columns, r, strict=True)) for r in rows)
    return RawTable(tuple(columns), rows, tuple(numbers or range(2, 2 + len(rows))), "simulated.csv", None)


def _codes(issues):
    return [(i.code, i.severity, i.row, i.column) for i in issues]


def test_pii_column_and_values():
    cols = ["Nom", "Date de naissance", "polymer name", "comment", "Valeur"]
    t = _table(cols, [
        ["x", "y", "PE", "jean@x.fr", "1"],
        ["x", "y", "PE", "06 12 34 56 78", "1"],
        ["x", "y", "PE", "12/03/1985", "1"],
    ], [2, 3, 4])
    m = Mapping("long", {"polymer": "polymer name", "reported_value": "Valeur"})
    issues = detect_pii(t, m)
    got = _codes(issues)
    assert ("E_PII_COLUMN", "error", None, "Nom") in got
    assert ("E_PII_COLUMN", "error", None, "Date de naissance") in got
    assert ("E_PII_VALUE", "error", 2, "comment") in got
    assert ("E_PII_VALUE", "error", 3, "comment") in got
    assert ("W_POSSIBLE_BIRTHDATE", "warning", 4, "comment") in got
    assert not any(c[3] == "polymer name" for c in got)
    assert len(got) == 5
    assert all(i.message for i in issues)


def test_pii_messages_do_not_echo_values():
    t = _table(["comment"], [["jean@x.fr"], ["06 12 34 56 78"], ["12/03/1985"]])
    for i in detect_pii(t, Mapping("long", {})):
        assert "jean" not in i.message and "06 12" not in i.message and "1985" not in i.message


def test_pii_scans_unmapped_columns_and_phone_formats():
    t = _table(["Other"], [["+213 555 12 34 56"], ["0612345678"], ["555-123-4567"], ["a@b.co"]])
    got = _codes(detect_pii(t, Mapping("long", {})))
    assert got == [("E_PII_VALUE", "error", n, "Other") for n in (2, 3, 4, 5)]


@pytest.mark.parametrize("text", [
    "0,13", "2.4", "1234", "D001", "12a", "0.123456789", "1.5e+10", "1234567890",
    "12 345", "0,43", "<LOD", "*0,3", "12,5", "3.14159265", "8 particles",
])
def test_ordinary_cells_are_not_pii(text):
    t = _table(["comment"], [[text]])
    assert detect_pii(t, Mapping("long", {})) == []


def test_birthdate_not_flagged_in_analysis_date_column():
    t = _table(["Date", "comment"], [["2021-06-01", "2021-06-01"], ["12/03/2020", ""]])
    got = _codes(detect_pii(t, Mapping("long", {"analysis_date": "Date"})))
    assert got == [("W_POSSIBLE_BIRTHDATE", "warning", 2, "comment")]


def test_pii_column_keywords_and_mapped_exemption():
    t = _table(["Patient", "E-mail", "Téléphone", "Adresse", "Sample ID"], [["", "", "", "", "S1"]])
    cols = [i.column for i in detect_pii(t, Mapping("long", {"sample_id": "Sample ID"}))]
    assert cols == ["Patient", "E-mail", "Téléphone", "Adresse"]
    # a patient column mapped to sample_id is still personal data
    t2 = _table(["Patient"], [["S1"]])
    assert [i.code for i in detect_pii(t2, Mapping("long", {"sample_id": "Patient"}))] == ["E_PII_COLUMN"]
