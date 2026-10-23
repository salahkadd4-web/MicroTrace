"""MicroPlastiX and RaSPI readers, and the reader registry (synthetic files only)."""
from __future__ import annotations

import pytest

from conftest import make_mpx, make_raspi, mpx_record, synthetic_points
from microtrace_core.readers import iter_all
from microtrace_core.readers.mpx import MPX_RAMAN_LASER_NM, read_mpx
from microtrace_core.readers.raspi import read_raspi


def test_mpx_reads_units_per_record(tmp_path):
    recs = [
        mpx_record("a_nm.csv", Analysis="Raman", x_unit="nm", y_unit="Intensity"),
        mpx_record("b_cm.csv", Analysis="Raman", x_unit="cm-1", y_unit="Intensity"),
        mpx_record("c_atr.csv", Analysis="ATR"),
    ]
    pts = synthetic_points()
    make_mpx(tmp_path, recs, {"a_nm.csv": pts, "b_cm.csv": pts, "c_atr.csv": pts})
    got = {s.spectrum_id: s for s in read_mpx(tmp_path)}
    assert got["mpx:a_nm"].x_unit == "nm" and got["mpx:a_nm"].laser_nm == 532.0
    assert got["mpx:b_cm"].x_unit == "cm-1" and got["mpx:b_cm"].laser_nm == MPX_RAMAN_LASER_NM
    assert got["mpx:c_atr"].technique == "ftir_atr" and got["mpx:c_atr"].laser_nm is None
    assert got["mpx:a_nm"].technique == "raman"
    assert got["mpx:c_atr"].file.endswith("dataset/c_atr.csv")


def test_mpx_groups_by_product(tmp_path):
    recs = [
        mpx_record("r1.csv", Region="VLFR", Treatment="bio"),
        mpx_record("r2.csv", Region="NSEA", Treatment="nobio"),
    ]
    pts = synthetic_points()
    make_mpx(tmp_path, recs, {"r1.csv": pts, "r2.csv": pts})
    a, b = list(read_mpx(tmp_path))
    assert a.sample_group == b.sample_group == "mpx:(09) PET"
    assert a.polymer == "PET" and a.polymer_raw == "(09) PET"
    assert a.state == "biofouled" and b.state == "weathered"
    assert a.extra["Region"] == "VLFR" and a.extra["Exposure_days"] == "30"
    assert a.extra["State"] == "dry"


def test_mpx_missing_file_warns(tmp_path):
    recs = [mpx_record("absent.csv"), mpx_record("here.csv")]
    make_mpx(tmp_path, recs, {"here.csv": synthetic_points()})
    with pytest.warns(UserWarning, match="absent.csv"):
        out = list(read_mpx(tmp_path))
    assert [s.spectrum_id for s in out] == ["mpx:here"]


def test_mpx_missing_folder_or_metadata_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        list(read_mpx(tmp_path))
    base = make_mpx(tmp_path, [], {})
    (base / "metadata.json").unlink()
    with pytest.raises(FileNotFoundError):
        list(read_mpx(tmp_path))


META = [
    ["PE1a", "white", "Shop", "bottle", "polyethylene", "523", "1800"],
    ["PE1b", "white", "Shop", "bottle", "polyethylene", "523", "1800"],
    ["PP14a", "black", "MH Plastics", "cream container,mhplastics.com/...,c16902/03",
     "polypropylene", "633", "1800"],
]


def test_raspi_drops_trailing_empty_cells(tmp_path):
    make_raspi(tmp_path, {"PE1a": synthetic_points()}, META, trailing=3)
    (s,) = list(read_raspi(tmp_path))
    assert len(s.x) == len(s.y) == 12
    assert not (s.x != s.x).any() and not (s.y != s.y).any()


def test_raspi_metadata_quoted_commas(tmp_path):
    make_raspi(tmp_path, {"PP14a": synthetic_points()}, META)
    (s,) = list(read_raspi(tmp_path))
    assert s.polymer == "PP" and s.laser_nm == 633.0
    assert s.x_unit == "cm-1" and s.state == "pristine" and s.source == "raspi"
    assert s.spectrum_id == "raspi:PP14a" and s.technique == "raman"


def test_raspi_sample_group_strips_suffix(tmp_path):
    make_raspi(tmp_path, {"PE1a": synthetic_points(), "PE1b": synthetic_points()}, META)
    groups = {s.sample_group for s in read_raspi(tmp_path)}
    assert groups == {"raspi:PE1"}


def test_raspi_unknown_id_warns(tmp_path):
    make_raspi(tmp_path, {"ZZ9": synthetic_points()}, META)
    with pytest.warns(UserWarning, match="ZZ9"):
        (s,) = list(read_raspi(tmp_path))
    assert s.polymer == "UNKNOWN" and s.polymer_raw == "" and s.laser_nm is None


def test_raspi_errors(tmp_path):
    with pytest.raises(FileNotFoundError):
        list(read_raspi(tmp_path))
    base = make_raspi(tmp_path, {"PE1a": synthetic_points()}, META)
    raw = base / "RaSPI_raw.csv"
    good = raw.read_text(encoding="utf-8")
    assert "intensity,1.0," in good
    raw.write_text(good.replace("intensity,1.0,", "intensity,", 1), encoding="utf-8")
    with pytest.raises(ValueError, match="PE1a"):
        list(read_raspi(tmp_path))
    raw.write_text(good.replace("intensity,1.0,", "intensity,abc,", 1), encoding="utf-8")
    with pytest.raises(ValueError, match="PE1a"):
        list(read_raspi(tmp_path))


def test_iter_all_chains_sources_in_order(tmp_path):
    from conftest import make_flopp, make_slopp, make_weathered
    pts = synthetic_points()
    make_mpx(tmp_path, [mpx_record("m.csv")], {"m.csv": pts})
    make_flopp(tmp_path, "FLOPP", {"PE 1.csv": pts})
    make_flopp(tmp_path, "FLOPP-e", {"PE 2.csv": pts})
    make_slopp(tmp_path, "SLoPP", {"Polyethylene/a.txt": pts})
    make_slopp(tmp_path, "SLoPP-E", {"Polyethylene/b.txt": pts})
    make_raspi(tmp_path, {"PE1a": pts}, META)
    make_weathered(tmp_path, {"sta-1.txt": pts},
                    rows=[("sta-1", "polyethylene", 90, "yes", None, None)])
    sources = [s.source for s in iter_all(tmp_path)]
    assert sources == ["mpx", "flopp", "flopp_e", "slopp", "slopp_e", "raspi",
                       "raman_weathered"]
