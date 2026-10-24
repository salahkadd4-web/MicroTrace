"""Checks on the real datasets/ (skipped when absent)."""
from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np
import pytest

from microtrace_core.catalog import build_catalog, grid_matrix, load_catalog
from microtrace_core.preprocess import GRIDS

pytestmark = pytest.mark.data


@pytest.fixture(scope="module")
def real_catalog(tmp_path_factory):
    datasets_root = Path(__file__).resolve().parents[2] / "datasets"
    if not (datasets_root / "Spectres").exists():
        pytest.skip("datasets/Spectres not found on disk")
    out = tmp_path_factory.mktemp("real_catalog")
    meta = build_catalog(datasets_root, out)
    return meta, load_catalog(out / "spectra_catalog.parquet")


def test_real_counts(real_catalog):
    meta, df = real_catalog
    assert meta["counts"]["by_source"] == {
        "mpx": 5809, "flopp": 186, "flopp_e": 195, "slopp": 148, "slopp_e": 113,
        "raspi": 402, "raman_weathered": 173}
    sel = df[(df.source == "mpx") & (df.technique == "raman") & (df.polymer == "PE")
             & (df.state == "weathered")]
    assert len(sel) > 0
    assert set(sel["laser_nm"]) == {532.0}
    frac = _peak_fraction(sel, [(2800, 2950)])
    assert frac >= 0.8, f"only {frac:.0%} of PE weathered peaks in 2800-2950"


def _peak_fraction(sel, windows) -> float:
    """Share of rows whose y_grid argmax lies in one of the windows; all-NaN rows fail."""
    grid = GRIDS["raman"]
    y = grid_matrix(sel)
    finite = np.isfinite(y).any(axis=1)
    peak = grid[np.argmax(np.where(np.isfinite(y), y, -np.inf), axis=1)]
    hit = np.zeros(len(y), dtype=bool)
    for lo, hi in windows:
        hit |= (peak >= lo) & (peak <= hi)
    return float(np.mean(hit & finite))


def test_mpx_raman_is_on_grid(real_catalog):
    _, df = real_catalog
    mpx = df[(df.source == "mpx") & (df.technique == "raman")]
    assert len(mpx) > 0
    low = mpx[~(mpx["coverage"] >= 0.5)]
    assert low.empty, f"{len(low)} MPX Raman spectra with coverage < 0.5: {list(low.spectrum_id[:5])}"
    assert not [w for w in real_catalog[0]["warnings"] if "coverage 0" in w]


def test_mpx_785_pp_bands(real_catalog):
    # Weathered only, as for PE/532: in biofouled spectra biofilm bands often dominate
    # the argmax (56 % in the windows on the 2026-10-24 data, vs 81 % for weathered).
    _, df = real_catalog
    sel = df[(df.source == "mpx") & (df.technique == "raman") & (df.laser_nm == 785.0)
             & (df.polymer == "PP") & (df.state == "weathered")]
    assert len(sel) > 0
    frac = _peak_fraction(sel, [(390, 410), (790, 850)])
    assert frac >= 0.8, f"only {frac:.0%} of 785 nm PP peaks at ~398 or 808/841 cm-1"


def test_peak_fraction_counts_all_nan_rows_as_failures():
    import pandas as pd
    n = len(GRIDS["raman"])
    good = np.zeros(n, np.float32)
    good[int(np.argmin(np.abs(GRIDS["raman"] - 2850)))] = 1.0
    sel = pd.DataFrame({"technique": ["raman"] * 2,
                        "y_grid": [good, np.full(n, np.nan, np.float32)]})
    assert _peak_fraction(sel, [(2800, 2950)]) == 0.5


@pytest.mark.parametrize("polymer", ["PE", "PET"])
def test_flopp_and_mpx_mean_spectra_agree(real_catalog, polymer):
    """Guard against unit/orientation mismatch between FLOPP (%T) and MPX (A)."""
    _, df = real_catalog
    flopp = df[(df.source == "flopp") & (df.polymer == polymer)]
    mpx = df[(df.source == "mpx") & (df.technique == "ftir_atr") & (df.polymer == polymer)
             & (df.state == "weathered")]
    assert len(flopp) > 0 and len(mpx) > 0
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN grid columns (padding)
        a, b = np.nanmean(grid_matrix(flopp), axis=0), np.nanmean(grid_matrix(mpx), axis=0)
    ok = np.isfinite(a) & np.isfinite(b)
    r = float(np.corrcoef(a[ok], b[ok])[0, 1])
    print(f"corr FLOPP vs MPX {polymer}: {r:.3f}")
    assert r > 0.8, f"{polymer}: r={r:.3f}"
