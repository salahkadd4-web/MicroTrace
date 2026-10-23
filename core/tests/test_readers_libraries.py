from __future__ import annotations

import hashlib

import pytest
from conftest import make_flopp, make_slopp, make_weathered, synthetic_points

from microtrace_core.readers.common import read_xy, sha256_file
from microtrace_core.readers.flopp import read_flopp
from microtrace_core.readers.slopp import read_slopp
from microtrace_core.readers.weathered import read_weathered


def test_flopp_reads_codes_and_states(tmp_path):
    make_flopp(tmp_path, "FLOPP", {
        "ABS 1. Orange LEGO Fragment.CSV": synthetic_points(),
        "PEA 1. Clear Double Sided Tape.CSV": synthetic_points(),
    })
    make_flopp(tmp_path, "FLOPP-e", {"CO 1. Grey Fiber.CSV": synthetic_points()})
    a = {s.spectrum_id: s for s in read_flopp(tmp_path, "FLOPP")}
    s = a["flopp:ABS 1. Orange LEGO Fragment"]
    assert s.polymer == "ABS" and s.state == "pristine" and s.source == "flopp"
    assert s.technique == "ftir_atr" and s.polymer_raw == "ABS"
    assert s.file == "Spectres/FLOPP .csv/ABS 1. Orange LEGO Fragment.CSV"
    assert len(s.x) == 12
    assert a["flopp:PEA 1. Clear Double Sided Tape"].polymer == "OTHER"
    (e,) = list(read_flopp(tmp_path, "FLOPP-e"))
    assert e.polymer == "CELLULOSE" and e.state == "weathered" and e.source == "flopp_e"
    assert e.spectrum_id == "flopp_e:CO 1. Grey Fiber"
    assert e.sample_group == e.spectrum_id
    assert e.file == "Spectres/FLOPP-e .csv/CO 1. Grey Fiber.CSV"


def test_flopp_sorted_and_missing_folder(tmp_path):
    with pytest.raises(FileNotFoundError):
        list(read_flopp(tmp_path, "FLOPP"))
    make_flopp(tmp_path, "FLOPP", {"R 10. b.CSV": synthetic_points(),
                                   "PE 1. a.CSV": synthetic_points()})
    ids = [s.spectrum_id for s in read_flopp(tmp_path, "FLOPP")]
    assert ids == sorted(ids)


def test_slopp_label_from_folder(tmp_path):
    rel = "Polyethylene/Polyethylene 1. Blue Sphere.txt"
    make_slopp(tmp_path, "SLoPP-E", {rel: synthetic_points()})
    make_slopp(tmp_path, "SLoPP", {"Nylon/Nylon 1. x.txt": synthetic_points()})
    (s,) = list(read_slopp(tmp_path, "SLoPP-E"))
    assert s.polymer == "PE" and s.state == "weathered" and s.source == "slopp_e"
    assert s.polymer_raw == "Polyethylene" and s.technique == "raman"
    assert s.x_unit == "cm-1" and len(s.x) == 12
    assert s.file == ("Spectres/SLoPP and SLoPP-E/SLoPP-E/Polyethylene/"
                      "Polyethylene 1. Blue Sphere.txt")
    (p,) = list(read_slopp(tmp_path, "SLoPP"))
    assert p.polymer == "PA" and p.state == "pristine" and p.source == "slopp"


def test_weathered_labels_from_xlsx(tmp_path):
    pts = synthetic_points()
    make_weathered(
        tmp_path,
        {"sta-1.txt": pts, "wea-15.txt": pts, "wea-99.txt": pts, "wea-20.txt": pts},
        rows=[
            ("sta-1", "PP", "/", "yes", 1, None),
            ("wea-15", "PE", "/", "not", 3, "identified By ATR-FTIR"),
            ("wea-20", "/", "/", "not", 4, None),
        ],
    )
    out = {s.spectrum_id: s for s in read_weathered(tmp_path)}
    assert out["raman_weathered:wea-15"].polymer == "PE"
    assert out["raman_weathered:wea-15"].label_note == "identified By ATR-FTIR"
    assert out["raman_weathered:wea-15"].state == "weathered"
    assert out["raman_weathered:wea-99"].polymer == "UNKNOWN"
    assert out["raman_weathered:wea-99"].polymer_raw == ""
    assert out["raman_weathered:wea-20"].polymer == "UNKNOWN"
    assert out["raman_weathered:wea-20"].label_note == ""
    s = out["raman_weathered:sta-1"]
    assert s.polymer == "PP" and s.state == "pristine" and len(s.x) == 12
    assert s.file.endswith("/sta-1.txt") and s.file.startswith("Spectres/A Raman")


def test_weathered_missing_folder_or_xlsx(tmp_path):
    with pytest.raises(FileNotFoundError):
        list(read_weathered(tmp_path))
    make_weathered(tmp_path, {"wea-1.txt": synthetic_points()})
    with pytest.raises(FileNotFoundError, match="content.xlsx"):
        list(read_weathered(tmp_path))


def test_slopp_missing_folder(tmp_path):
    with pytest.raises(FileNotFoundError):
        list(read_slopp(tmp_path, "SLoPP"))


def test_weathered_sta_slash_is_unknown(tmp_path):
    make_weathered(tmp_path, {"sta-2.txt": synthetic_points()},
                   rows=[("sta-2", "/", "/", "yes", 1, None)])
    (s,) = list(read_weathered(tmp_path))
    assert s.polymer == "UNKNOWN" and s.state == "pristine"


def test_weathered_duplicate_id_raises(tmp_path):
    make_weathered(tmp_path, {"wea-1.txt": synthetic_points()},
                   rows=[("wea-1", "PE", "/", "x", 1, None), ("wea-1", "PP", "/", "x", 2, None)])
    with pytest.raises(ValueError, match="wea-1"):
        list(read_weathered(tmp_path))


def test_weathered_skips_unexpected_txt_with_warning(tmp_path):
    make_weathered(tmp_path, {"wea-1.txt": synthetic_points(), "notes.txt": synthetic_points()},
                   rows=[("wea-1", "PE", "/", "x", 1, None)])
    with pytest.warns(UserWarning, match="notes.txt"):
        out = list(read_weathered(tmp_path))
    assert [s.spectrum_id for s in out] == ["raman_weathered:wea-1"]


def test_readers_raise_on_too_few_points(tmp_path):
    make_flopp(tmp_path, "FLOPP", {"PE 1. short.CSV": synthetic_points(5)})
    with pytest.raises(ValueError, match="short.CSV"):
        list(read_flopp(tmp_path, "FLOPP"))


def test_read_xy_skips_blank_and_short_rows(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("1\t2\n\n3\n4\t5\t\n6\t\n7\t8\n", encoding="utf-8")
    x, y = read_xy(f, "\t")
    assert x.tolist() == [1.0, 4.0, 7.0] and y.tolist() == [2.0, 5.0, 8.0]


def test_read_xy_non_numeric_raises_with_line(tmp_path):
    f = tmp_path / "bad.txt"
    f.write_text("1 2\n3 4\nabc def\n", encoding="utf-8")
    with pytest.raises(ValueError, match=r"bad\.txt.*line 3"):
        read_xy(f, None)


def test_read_xy_skip_rows(tmp_path):
    f = tmp_path / "h.txt"
    f.write_text("x y\n1 2\n", encoding="utf-8")
    x, _ = read_xy(f, None, skip_rows=1)
    assert x.tolist() == [1.0]


def test_read_xy_decimal_comma_raises(tmp_path):
    f = tmp_path / "c.txt"
    f.write_text("1,5;2,3\n", encoding="utf-8")
    with pytest.raises(ValueError, match="line 1"):
        read_xy(f, ";")


def test_sha256_file(tmp_path):
    f = tmp_path / "z.bin"
    f.write_bytes(b"hello" * 1000)
    assert sha256_file(f) == hashlib.sha256(b"hello" * 1000).hexdigest()
