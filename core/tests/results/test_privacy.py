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
    assert ("W_POSSIBLE_BIRTHDATE", "warning", None, "comment") in got
    assert not any(c[3] == "polymer name" for c in got)
    assert len(got) == 5
    assert all(i.message for i in issues)


def test_pii_messages_do_not_echo_values():
    t = _table(["comment"], [["jean@x.fr"], ["06 12 34 56 78"], ["12/03/1985"]])
    for i in detect_pii(t, Mapping("long", {})):
        assert "jean" not in i.message and "06 12" not in i.message and "1985" not in i.message


import time

from microtrace_core.results.privacy import MAX_SCAN_CHARS


@pytest.mark.parametrize("text", [
    "+213 555 12 34 56", "0612345678", "06 12 34 56 78", "06/12/34/56/78", "555-123-4567",
    "(555) 123-4567", "Tel.0612345678", "tel.06 12 34 56 78", "a@b.co", "jean.dupont@x.fr",
])
def test_contact_values_flagged(text):
    t = _table(["Other"], [[text]])
    assert _codes(detect_pii(t, Mapping("long", {}))) == [("E_PII_VALUE", "error", 2, "Other")]


@pytest.mark.parametrize("text", [
    "0,13", "2.4", "1234", "D001", "12a", "0.123456789", "1.5e+10", "1234567890",
    "12 345", "0,43", "<LOD", "*0,3", "12,5", "3.14159265", "8 particles",
    "2021-06-01 10:30:00", "01/06/2021", "MT-2021-001-01", "S-001-002-003",
    "Lot 2021-06-01-001", "ISBN 978-3-16-148410-0", "10-20-30-40-50", "1 234 567 890",
    "1 000 000 000", "12.0612345678",
    "01/06/2021 10:30", "02/06/2021 14:05:00", "01/06/2021 10:30:00", "05.06.2021 14:00",
    "06/01/2021 12:45", "01-06-2021 09:15", "01/06/2021 10h30", "01/06/2021-10:30",
    "2021-06-01T10:30:00",
])
def test_ordinary_cells_are_not_phone_or_email(text):
    t = _table(["comment"], [[text]])
    assert [i for i in detect_pii(t, Mapping("long", {})) if i.code == "E_PII_VALUE"] == []


@pytest.mark.parametrize("text", ["0,13", "2.4", "1234", "D001", "12a", "0.123456789", "<LOD"])
def test_ordinary_cells_raise_nothing(text):
    t = _table(["comment"], [[text]])
    assert detect_pii(t, Mapping("long", {})) == []


def test_birthdate_one_warning_per_column_with_count():
    t = _table(["comment"], [["12/03/1985"], ["x"], ["1990-01-02"]])
    got = detect_pii(t, Mapping("long", {}))
    assert _codes(got) == [("W_POSSIBLE_BIRTHDATE", "warning", None, "comment")]
    assert "2" in got[0].message


def test_birthdate_not_flagged_in_analysis_date_column():
    t = _table(["Date", "comment"], [["2021-06-01", "2021-06-01"], ["12/03/2020", ""]])
    got = _codes(detect_pii(t, Mapping("long", {"analysis_date": "Date"})))
    assert got == [("W_POSSIBLE_BIRTHDATE", "warning", None, "comment")]


@pytest.mark.parametrize("header", [
    "Platelets", "Plaquettes", "Nombre de particules", "Nominal volume", "Volume nominal",
    "Nomenclature", "Dénomination", "Monomer", "Monomère", "Genome", "Telomere", "Satellite",
    "Tellurium", "Unirradiated", "Dobutamine", "Sample name", "Polymer name", "Nom du polymère",
    "Valeur", "Polymer",
])
def test_innocent_headers(header):
    t = _table([header], [["1"]])
    assert detect_pii(t, Mapping("long", {})) == []


@pytest.mark.parametrize("header", [
    "Nom", "Prénom", "Name", "Full name", "Date de naissance", "DOB", "E-mail", "Tél.",
    "N° tel", "Téléphone", "Adresse", "NIR", "N° de dossier", "FirstName", "Mass name",
])
def test_pii_headers(header):
    t = _table([header], [["1"]])
    got = detect_pii(t, Mapping("long", {}))
    assert [(i.code, i.severity, i.column) for i in got] == [("E_PII_COLUMN", "error", header)]


@pytest.mark.parametrize("header", ["Patient ID", "Code patient", "Patient"])
def test_patient_header_is_only_a_warning(header):
    t = _table([header], [["S1"]])
    for m in (Mapping("long", {}), Mapping("long", {"sample_id": header})):
        got = detect_pii(t, m)
        assert [(i.code, i.severity, i.column) for i in got] == [("W_POSSIBLE_PII_COLUMN", "warning", header)]
        assert "pseudonymis" in got[0].message


@pytest.mark.parametrize("header,field", [
    ("Date de naissance", "analysis_date"), ("Nom du patient", "comment"), ("Adresse", "lab"),
])
def test_mapping_never_bypasses_header_check(header, field):
    t = _table([header], [["x"]])
    got = detect_pii(t, Mapping("long", {field: header}))
    assert [(i.code, i.column) for i in got if i.severity == "error"] == [("E_PII_COLUMN", header)]


@pytest.mark.parametrize("cell", ["a@" * 500_000, "0 " * 500_000, "1" * 1_000_000, "a." * 500_000],
                         ids=["at", "zero-space", "digits", "dots"])
def test_adversarial_cells_scan_fast(cell):
    t = _table(["comment"], [[cell]])
    start = time.perf_counter()
    detect_pii(t, Mapping("long", {}))
    assert time.perf_counter() - start < 1.0
    assert MAX_SCAN_CHARS == 1000


@pytest.mark.parametrize("header", [
    "Noms", "Prénoms", "Names", "Adresses", "Addresses", "Emails", "E-mails", "Phones", "Nom1",
    "Email1", "Tel2", "Prenom2", "DOBDate", "SSNumber", "IPPNumber", "NIRPatient", "Mobile",
    "N° portable", "Tel mobile", "Birth date", "Date of birth", "Birth", "Né(e) le", "Née le",
    "Ne le", "Sécu sociale", "N° sécu",
])
def test_robust_pii_headers(header):
    t = _table([header], [["1"]])
    got = detect_pii(t, Mapping("long", {}))
    assert [(i.code, i.column) for i in got if i.severity == "error"] == [("E_PII_COLUMN", header)]


@pytest.mark.parametrize("header", [
    "Nombre", "Nombres", "Mobile phase", "Portable instrument", "Birth weight (g)",
    "Sample names", "Plaquettes", "Platelets", "Monomers",
])
def test_robust_innocent_headers(header):
    t = _table([header], [["1"]])
    assert detect_pii(t, Mapping("long", {})) == []


def test_patient_column_with_names_is_blocked():
    t = _table(["Code patient"], [["Jean Dupont"], ["P001"], ["Marie-Claire"], ["O'Neil"], ["12a"]])
    got = detect_pii(t, Mapping("long", {}))
    values = [(i.row, i.column) for i in got if i.code == "E_PII_VALUE"]
    assert values == [(2, "Code patient"), (4, "Code patient"), (5, "Code patient")]
    assert any(i.code == "W_POSSIBLE_PII_COLUMN" for i in got)
    assert all("Dupont" not in i.message and "Neil" not in i.message for i in got)


def test_patient_column_with_codes_only_warns():
    t = _table(["Patient"], [["P001"], ["12a"], [""], ["3"]])
    assert [i.code for i in detect_pii(t, Mapping("long", {}))] == ["W_POSSIBLE_PII_COLUMN"]


def test_other_columns_with_names_not_flagged():
    t = _table(["Polymer"], [["Polyethylene"]])
    assert detect_pii(t, Mapping("long", {})) == []


@pytest.mark.parametrize("header", [
    "Place of birth", "Year of birth", "Mobile number", "Patient birth", "Mobile 2", "Birthday",
    "Birthplace", "NIR", "N° NIR", "SSN", "SSNumber", "IPPs", "TELs",
])
def test_default_deny_headers(header):
    t = _table([header], [["1"]])
    got = detect_pii(t, Mapping("long", {}))
    assert [i.code for i in got if i.severity == "error"] == ["E_PII_COLUMN"]


@pytest.mark.parametrize("header", [
    "Birth weight (g)", "Weight at birth", "Mobile phase", "Phase mobile", "Portable instrument",
    "NIR spectra", "NIR signal", "SSNR", "Studies name", "Nombre",
])
def test_excused_headers(header):
    t = _table([header], [["1"]])
    assert detect_pii(t, Mapping("long", {})) == []


@pytest.mark.parametrize("header", ["aB" * 500_000, " ".join(["tok"] * 4000) + " x" * 4000],
                         ids=["1MB", "8000-tokens"])
def test_huge_headers_are_fast(header):
    t = _table([header], [["1"]])
    start = time.perf_counter()
    detect_pii(t, Mapping("long", {}))
    assert time.perf_counter() - start < 1.0


@pytest.mark.parametrize("text", [
    "06.12.34 56 78", "06/12/34 56 78", "01/02/03 04 05", "31/02/2021 0612345678",
    "01/06/2021 10:30 0612345678", "25/13/2021 0612345678",
])
def test_phones_next_to_dates_or_fake_dates_flagged(text):
    t = _table(["Other"], [[text]])
    assert _codes(detect_pii(t, Mapping("long", {"analysis_date": "Other"}))) == [
        ("E_PII_VALUE", "error", 2, "Other")]


@pytest.mark.parametrize("cell", ["Dupont, Jean", "J. Dupont", "Jean.Dupont", "Jean_Dupont"])
def test_patient_names_with_separators(cell):
    t = _table(["Patient"], [[cell]])
    assert [(i.code, i.row) for i in detect_pii(t, Mapping("long", {})) if i.code == "E_PII_VALUE"] == [
        ("E_PII_VALUE", 2)]


@pytest.mark.parametrize("cell", ["NA", "n/a", "nd", "Inconnu", "unknown", "Témoin", "temoin",
                                  "Contrôle", "control", "Blank", "blanc", "vide"])
def test_patient_placeholders_are_not_names(cell):
    t = _table(["Patient"], [[cell]])
    assert [i.code for i in detect_pii(t, Mapping("long", {}))] == ["W_POSSIBLE_PII_COLUMN"]


@pytest.mark.parametrize("text", [
    "01/06/2021 10h", "05/06/2021 15 particules", "prélevé le 05/06/2021 10 mL", "05/06/2021 10 µm",
    "05/06/2021 20 °C", "01/06/2021-01", "05.06.2021-12", "01/06/2021 10 h",
])
def test_dated_measurements_are_not_phones(text):
    t = _table(["comment"], [[text]])
    assert [i for i in detect_pii(t, Mapping("long", {})) if i.code == "E_PII_VALUE"] == []


@pytest.mark.parametrize("text", [
    "01/06/2021 10:30 06 12 34 56 78", "05/06/2021 06 12 34 56 78", "05/06/2021 0612345678",
])
def test_phones_after_valid_dates_flagged(text):
    t = _table(["Other"], [[text]])
    assert _codes(detect_pii(t, Mapping("long", {"analysis_date": "Other"}))) == [
        ("E_PII_VALUE", "error", 2, "Other")]


@pytest.mark.parametrize("header", [
    "Year of birth (study)", "Study year of birth", "Place of birth lot", "Mobile number lab",
    "Lab mobile", "Laboratory mobile", "Birthing", "Birthday", "Birthplace",
])
def test_qualifiers_do_not_excuse_birth_or_mobile(header):
    t = _table([header], [["1"]])
    got = detect_pii(t, Mapping("long", {}))
    assert [i.code for i in got if i.severity == "error"] == ["E_PII_COLUMN"]


@pytest.mark.parametrize("header", [
    "Portable XRF", "pXRF portable", "Portable FTIR", "Portable Raman", "Portable NIRS spectra",
    "Portable spectrophotometer", "Birthweight", "Birthweight (g)", "Birthorder", "Birthrate",
    "Birthrates", "Birthcohort", "Species name", "Series name",
])
def test_scientific_headers_excused(header):
    t = _table([header], [["1"]])
    assert detect_pii(t, Mapping("long", {})) == []


@pytest.mark.parametrize("cell", ["n.a.", "N.A.", "na.", "NR", "nc", "N.C.", "Pool", "QC", "Standard",
                                  "témoins", "Temoins", "controls", "contrôles", "Controles",
                                  "blanks", "Blancs"])
def test_more_patient_placeholders_are_not_names(cell):
    t = _table(["Patient"], [[cell]])
    assert [i.code for i in detect_pii(t, Mapping("long", {}))] == ["W_POSSIBLE_PII_COLUMN"]


# ---- final review ----


def test_pii_issue_field_is_the_mapped_standard_field():
    t = _table(["Code patient", "comment"], [["Jean Dupont", "a@b.fr"]])
    got = detect_pii(t, Mapping("long", {"sample_id": "Code patient"}))
    assert {(i.code, i.column, i.field) for i in got} == {
        ("W_POSSIBLE_PII_COLUMN", "Code patient", "sample_id"),
        ("E_PII_VALUE", "Code patient", "sample_id"), ("E_PII_VALUE", "comment", None)}
