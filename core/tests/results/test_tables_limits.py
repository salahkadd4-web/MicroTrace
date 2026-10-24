import csv

import pytest
from openpyxl import Workbook

from microtrace_core.results import tables
from microtrace_core.results.tables import TableReadError, read_table


def _xlsx(tmp_path, rows):
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    p = tmp_path / "t.xlsx"
    wb.save(p)
    return p.read_bytes()


def test_limit_bytes(monkeypatch):
    monkeypatch.setattr(tables, "MAX_BYTES", 10)
    with pytest.raises(TableReadError, match="volumineux"):
        read_table(b"a;b\n1;2\n3;4\n", "r.csv")


def test_limit_uncompressed(tmp_path, monkeypatch):
    xl = _xlsx(tmp_path, [["a", "b"], [1, 2]])
    monkeypatch.setattr(tables, "MAX_UNCOMPRESSED_BYTES", 100)
    with pytest.raises(TableReadError, match="décompressé"):
        read_table(xl, "r.xlsx")


def test_limit_columns(tmp_path, monkeypatch):
    xl = _xlsx(tmp_path, [["a", "b"], [1, 2]])
    monkeypatch.setattr(tables, "MAX_COLUMNS", 1)
    with pytest.raises(TableReadError, match="colonnes"):
        read_table(b"a;b\n1;2\n", "r.csv")
    with pytest.raises(TableReadError, match="colonnes"):
        read_table(xl, "r.xlsx")


def test_limit_rows(tmp_path, monkeypatch):
    xl = _xlsx(tmp_path, [["a"], [1], [2]])
    monkeypatch.setattr(tables, "MAX_ROWS", 1)
    with pytest.raises(TableReadError, match="lignes"):
        read_table(b"a\n1\n2\n", "r.csv")
    with pytest.raises(TableReadError, match="lignes"):
        read_table(xl, "r.xlsx")
    assert len(read_table(b"a\n1\n", "r.csv").rows) == 1


def test_xlsx_invalid_zip():
    with pytest.raises(TableReadError, match="invalide"):
        read_table(b"not a zip", "r.xlsx")


def test_xlsx_uncached_formula(tmp_path):
    data = _xlsx(tmp_path, [["a", "b"], [1, "=A2*2"]])
    with pytest.raises(TableReadError, match="B2") as e:
        read_table(data, "r.xlsx")
    assert "enregistrez" in str(e.value)


def test_encodings():
    t = read_table("a;b\nx;é\n".encode("utf-16"), "r.csv")
    assert t.rows[0] == {"a": "x", "b": "é"}
    t = read_table(b"\xfe\xff" + "a;b\nx;1\n".encode("utf-16-be"), "r.csv")
    assert t.columns == ("a", "b")
    with pytest.raises(TableReadError, match="ncodage"):
        read_table(b"a;b\n\x81;1\n", "r.csv")


def test_csv_field_too_large():
    old = csv.field_size_limit(5)
    try:
        with pytest.raises(TableReadError, match="illisible"):
            read_table(b"a;b\n1234567890;1\n", "r.csv")
    finally:
        csv.field_size_limit(old)


def test_long_row_trailing_empties_ok():
    t = read_table(b"a;b\n1;2;;\n", "r.csv")
    assert t.rows[0] == {"a": "1", "b": "2"}


def test_duplicate_header_after_normalisation():
    with pytest.raises(TableReadError, match="Unité"):
        read_table("Unité;Unité \n1;2\n".encode("utf-8"), "r.csv")


def test_no_header_row():
    with pytest.raises(TableReadError, match="aucun en-tête"):
        read_table(b"\n;;\n\n", "r.csv")


def test_limit_total_rows_blank_csv_and_xlsx(tmp_path, monkeypatch):
    monkeypatch.setattr(tables, "MAX_ROWS", 2)
    monkeypatch.setattr(tables, "MAX_BLANK_ROWS", 3)
    blanks = ["a\n1\n"] + [";\n"] * 5
    with pytest.raises(TableReadError, match="vides comprises"):
        read_table("".join(blanks).encode(), "r.csv")
    xl = _xlsx(tmp_path, [["a"], [1]] + [[None]] * 4 + [[None, None, 1]])
    with pytest.raises(TableReadError, match="lignes"):
        read_table(xl, "r.xlsx")
    ok = _xlsx(tmp_path, [["a"], [1], [None], [None], [2]])
    assert read_table(ok, "r.xlsx").row_numbers == (2, 5)


def test_forged_dimension_is_ignored(tmp_path):
    import io
    import zipfile
    xl = _xlsx(tmp_path, [["a", "b"], [1, 2]])
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(xl)) as zin, zipfile.ZipFile(out, "w") as zout:
        for item in zin.infolist():
            buf = zin.read(item.filename)
            if item.filename == "xl/worksheets/sheet1.xml":
                assert b'<dimension ref="A1:B2"' in buf
                buf = buf.replace(b'<dimension ref="A1:B2"', b'<dimension ref="A1:XFD1048576"')
            zout.writestr(item, buf)
    t = read_table(out.getvalue(), "r.xlsx")
    assert t.rows == ({"a": "1", "b": "2"},) and t.row_numbers == (2,)


def test_csv_wide_row_beyond_max_columns(monkeypatch):
    monkeypatch.setattr(tables, "MAX_COLUMNS", 2)
    with pytest.raises(TableReadError, match="colonnes"):
        read_table(b"a;b\n1;2;;;;x\n", "r.csv")
    t = read_table(b"a;b\n1;2;;;;;\n", "r.csv")
    assert t.rows == ({"a": "1", "b": "2"},)


def test_xlsx_cell_beyond_max_columns(tmp_path, monkeypatch):
    xl = _xlsx(tmp_path, [["a", "b"], [1, 2, 3]])
    monkeypatch.setattr(tables, "MAX_COLUMNS", 2)
    with pytest.raises(TableReadError):
        read_table(xl, "r.xlsx")


def test_duplicate_header_with_contact_data_not_echoed():
    with pytest.raises(TableReadError) as e:
        read_table("a@b.fr;a@b.fr\n1;2\n".encode("utf-8"), "r.csv")
    assert "a@b.fr" not in str(e.value) and "n° 1" in str(e.value)


def test_duplicate_long_header_not_echoed():
    h = "y" * 1100 + "jean.dupont@chu.fr"
    with pytest.raises(TableReadError) as e:
        read_table(f"{h};{h}\n1;2\n".encode("utf-8"), "r.csv")
    assert "jean.dupont" not in str(e.value)
