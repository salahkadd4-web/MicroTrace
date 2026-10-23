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
    grid = GRIDS["raman"]
    y = grid_matrix(sel)
    peak = grid[np.nanargmax(np.where(np.isfinite(y), y, -np.inf), axis=1)]
    frac = np.mean((peak >= 2800) & (peak <= 2950))
    assert frac >= 0.8, f"only {frac:.0%} of PE weathered peaks in 2800-2950"


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
