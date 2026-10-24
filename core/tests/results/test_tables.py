from datetime import date, datetime, time

import pytest
from openpyxl import Workbook

from microtrace_core.results import tables
from microtrace_core.results.tables import RawTable, TableReadError, read_table


def _xlsx(tmp_path, rows, title=None, extra_sheet=None):
    wb = Workbook()
    ws = wb.active
    if title:
        ws.title = title
    for r in rows:
        ws.append(r)
    if extra_sheet:
        wb.create_sheet(extra_sheet)
    p = tmp_path / "t.xlsx"
    wb.save(p)
    return p.read_bytes()


def test_read_csv_semicolon_decimal_comma():
    t = read_table(b"sample_id;value\nD1;1,2\n", "r.csv")
    assert isinstance(t, RawTable)
    assert t.columns == ("sample_id", "value")
    assert t.rows[0]["value"] == "1,2"
    assert t.row_numbers == (2,) and t.source_name == "r.csv" and t.sheet is None


def test_read_csv_comma_and_tab_and_quotes():
    t = read_table(b'a,b\n"x,y",2\n', "r.csv")
    assert t.rows[0] == {"a": "x,y", "b": "2"}
    t = read_table(b"a\tb\n1\t2\n", "r.tsv")
    assert t.columns == ("a", "b")
    t = read_table(b'a;b\n"x;y";1,5\n', "r.txt")
    assert t.rows[0] == {"a": "x;y", "b": "1,5"}


def test_read_csv_keeps_leading_zeros():
    t = read_table(b"id;v\n001;2\n", "r.csv")
    assert t.rows[0]["id"] == "001"


def test_read_csv_cp1252_fallback():
    t = read_table("Matrice;Unité\nsang;µg/mL\n".encode("cp1252"), "r.csv")
    assert t.columns == ("Matrice", "Unité")
    assert t.rows[0]["Unité"] == "µg/mL"


def test_read_csv_utf8_bom_and_nbsp():
    t = read_table("﻿a;b\xa0\n\xa01;2\n".encode("utf-8"), "r.csv")
    assert t.columns == ("a", "b") and t.rows[0] == {"a": "1", "b": "2"}


def test_read_csv_short_and_long_rows():
    t = read_table(b"a;b;c\n1;2\n", "r.csv")
    assert t.rows[0] == {"a": "1", "b": "2", "c": ""}
    with pytest.raises(TableReadError, match="Ligne 3"):
        read_table(b"a;b\n1;2\n1;2;3\n", "r.csv")


def test_read_csv_empty_header_named():
    t = read_table(b"a;;c\n1;2;3\n", "r.csv")
    assert t.columns == ("a", "colonne_2", "c")


def test_read_xlsx_typed_cells(tmp_path):
    data = _xlsx(tmp_path, [
        ["Polymère\xa0", "v", "w", "d", "ok", "dt"],
        ["PE", 0.3, 1, datetime(2021, 6, 1), True, datetime(2021, 6, 1, 8, 30)],
        ["PP", 2.0, "001", date(2021, 7, 2), None, time(8, 5)],
    ])
    t = read_table(data, "r.xlsx")
    assert t.columns[0] == "Polymère"
    assert t.rows[0] == {"Polymère": "PE", "v": "0.3", "w": "1", "d": "2021-06-01",
                         "ok": "TRUE", "dt": "2021-06-01T08:30:00"}
    assert t.rows[1] == {"Polymère": "PP", "v": "2", "w": "001", "d": "2021-07-02",
                         "ok": "", "dt": "08:05:00"}
    assert t.sheet == "Sheet"


def test_read_xlsx_sheet_selection(tmp_path):
    data = _xlsx(tmp_path, [["a"], [1]], title="Un", extra_sheet="Deux")
    assert read_table(data, "r.xlsx").sheet == "Un"
    with pytest.raises(TableReadError, match="Un"):
        read_table(data, "r.xlsx", sheet="Trois")


def test_read_table_skips_blank_rows_keeps_row_numbers(tmp_path):
    data = _xlsx(tmp_path, [["a", "b"], ["1", "2"], [None, None], ["3", "4"], [None, None]])
    t = read_table(data, "r.xlsx")
    assert t.row_numbers == (2, 4)
    t = read_table(b"a;b\n1;2\n;\n\n3;4\n\n", "r.csv")
    assert t.row_numbers == (2, 5) and len(t.rows) == 2


def test_read_table_errors(tmp_path):
    with pytest.raises(TableReadError):
        read_table(b"x", "r.ods")
    with pytest.raises(TableReadError, match="a"):
        read_table(b"a;a\n1;2\n", "r.csv")
    with pytest.raises(TableReadError):
        read_table(b"a;b\n", "r.csv")
    with pytest.raises(TableReadError):
        read_table(b"", "r.csv")
    with pytest.raises(TableReadError):
        read_table(_xlsx(tmp_path, [["a", "b"]]), "r.xlsx")
    with pytest.raises(TableReadError):
        read_table(b"not a zip", "r.xlsx")
    assert issubclass(TableReadError, ValueError)


def test_xlsx_numbers_never_in_exponent_form(tmp_path):
    data = _xlsx(tmp_path, [["a", "b", "c", "d", "e", "f"],
                            [1e-05, 1.5e20, 1.23e-07, 1e16, -0.5, 2.50]])
    t = read_table(data, "r.xlsx")
    assert t.rows[0] == {"a": "0.00001", "b": "150000000000000000000", "c": "0.000000123",
                         "d": "10000000000000000", "e": "-0.5", "f": "2.5"}


@pytest.mark.parametrize("value,text", [(10 ** 25, "10000000000000000000000000"), (7, "7"),
                                        (1.23e-7, "0.000000123"), (2.0, "2"), (1e22, "1e+22"),
                                        (123456.789, "123456.789")])
def test_cell_text_plain_digits(value, text):
    assert tables._cell_text(value) == text


def test_limit_cells(monkeypatch):
    monkeypatch.setattr(tables, "MAX_CELLS", 5)
    with pytest.raises(TableReadError, match="cellules"):
        read_table(b"a;b;c\n1;2;3\n4;5;6\n", "r.csv")
    assert len(read_table(b"a;b;c\n1;2;3\n", "r.csv").rows) == 1
    assert tables.MAX_CELLS == 5


@pytest.mark.parametrize("value", [1e308, 5e-324, -1e300, 1e21, 9e-13, 1.7976931348623157e308])
def test_extreme_floats_keep_short_exponent_form(value):
    from microtrace_core.results.censoring import parse_reported_value
    text = tables._cell_text(value)
    assert len(text) <= 32 and "e" in text
    r = parse_reported_value(text)
    assert r.ok and r.hint is None and r.value == value


@pytest.mark.parametrize("value,text", [(1e-05, "0.00001"), (0.0, "0"), (1e-12, "0.000000000001"),
                                        (9.99e20, "999000000000000000000")])
def test_floats_in_range_have_no_exponent(value, text):
    assert tables._cell_text(value) == text
