"""Tests of the Parquet catalogue and the CLI (synthetic trees only)."""
from __future__ import annotations

import json
import subprocess
import sys
import warnings

import numpy as np
import pandas as pd
import pytest
from conftest import (
    make_flopp, make_mpx, make_raspi, make_slopp, make_weathered, mpx_record,
    synthetic_points,
)

from microtrace_core import catalog, readers
from microtrace_core.catalog import build_catalog, grid_matrix, load_catalog
from microtrace_core.preprocess import GRIDS, PREPROCESS_VERSION
from microtrace_core.readers.common import sha256_file
from microtrace_core.spectrum import Spectrum

META = [["PE1a", "white", "Shop", "bottle", "polyethylene", "523", "1800"]]
SOURCES = {"mpx", "flopp", "flopp_e", "slopp", "slopp_e", "raspi", "raman_weathered"}


def make_tree(root):
    pts = synthetic_points(60, start=700.0, step=20.0)
    make_mpx(root, [mpx_record("m.csv")], {"m.csv": pts})
    make_flopp(root, "FLOPP", {"PE 1.csv": pts})
    make_flopp(root, "FLOPP-e", {"PE 2.csv": pts})
    make_slopp(root, "SLoPP", {"Polyethylene/a.txt": pts})
    make_slopp(root, "SLoPP-E", {"Polyethylene/b.txt": pts})
    make_raspi(root, {"PE1a": pts}, META)
    make_weathered(root, {"sta-1.txt": pts},
                   rows=[("sta-1", "polyethylene", 90, "yes", None, None)])


def test_build_catalog_roundtrip(tmp_path):
    ds, out = tmp_path / "ds", tmp_path / "out"
    make_tree(ds)
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # reader warnings must not leak
        meta = build_catalog(ds, out)
    assert set(meta["counts"]["by_source"]) == SOURCES
    assert meta["data_nature"] == (
        "reference/environmental polymers — not human biological matrices")
    assert meta["preprocess_version"] == PREPROCESS_VERSION
    assert meta["grids"]["ftir_atr"] == [600.0, 4000.0, 4.0]
    assert meta["grids"]["raman"] == [250.0, 3198.0, 4.0]
    assert json.loads((out / "catalog_meta.json").read_text(encoding="utf-8")) == meta
    df = load_catalog(out / "spectra_catalog.parquet")
    assert len(df) == 7
    originals = {s.spectrum_id: s for s in readers.iter_all(ds)}
    for row in df.itertuples():
        s = originals[row.spectrum_id]
        np.testing.assert_array_equal(np.asarray(row.x_raw), s.x)
        assert row.file_sha256 == sha256_file(ds / s.file)
        assert json.loads(row.extra) == s.extra
    assert set(df.columns) == {
        "spectrum_id", "source", "technique", "polymer", "polymer_raw", "state",
        "sample_group", "file", "file_sha256", "laser_nm", "x_unit", "label_note",
        "coverage", "x_raw", "y_raw", "y_grid", "extra"}


def test_build_catalog_rejects_duplicate_ids(tmp_path, monkeypatch):
    def spec():
        return Spectrum(
            spectrum_id="dup:1", source="flopp", technique="ftir_atr",
            x=np.arange(700, 1300, 10.0), y=np.ones(60), x_unit="cm-1",
            polymer="PE", polymer_raw="PE", state="pristine", sample_group="g",
            file="a.csv")
    (tmp_path / "a.csv").write_text("x", encoding="utf-8")
    monkeypatch.setattr(readers, "iter_all", lambda root: iter([spec(), spec()]))
    with pytest.raises(ValueError, match="dup:1"):
        build_catalog(tmp_path, tmp_path / "out")


def test_build_catalog_captures_reader_warnings(tmp_path):
    ds = tmp_path / "ds"
    make_tree(ds)
    make_raspi(ds, {"ZZ9": synthetic_points(60, 700.0, 20.0)}, META)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        meta = build_catalog(ds, tmp_path / "out")
    assert any("ZZ9" in w for w in meta["warnings"])


def test_grid_matrix_rejects_mixed_techniques():
    df = pd.DataFrame({"technique": ["raman", "ftir_atr"],
                       "y_grid": [np.zeros(738, np.float32), np.zeros(851, np.float32)]})
    with pytest.raises(ValueError):
        grid_matrix(df)


def test_grid_matrix_shape(tmp_path):
    ds = tmp_path / "ds"
    make_tree(ds)
    build_catalog(ds, tmp_path / "out")
    df = load_catalog(tmp_path / "out" / "spectra_catalog.parquet")
    raman = df[df.technique == "raman"]
    m = grid_matrix(raman)
    assert m.dtype == np.float32 and m.shape == (len(raman), len(GRIDS["raman"]))


def test_git_commit_unknown_on_failure(monkeypatch):
    def boom(*a, **k):
        raise OSError("no git")
    monkeypatch.setattr(catalog.subprocess, "run", boom)
    assert catalog._git_commit() == "unknown"


def test_cli_build_catalog(tmp_path):
    ds, out = tmp_path / "ds", tmp_path / "out"
    make_tree(ds)
    r = subprocess.run(
        [sys.executable, "-m", "microtrace_core", "build-catalog",
         "--datasets", str(ds), "--out", str(out)],
        capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert (out / "spectra_catalog.parquet").exists()
    assert (out / "catalog_meta.json").exists()
