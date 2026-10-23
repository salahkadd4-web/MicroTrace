"""Checks on the real datasets/ (skipped when absent)."""
from __future__ import annotations

import numpy as np
import pytest

from microtrace_core.catalog import build_catalog, grid_matrix, load_catalog
from microtrace_core.preprocess import GRIDS

pytestmark = pytest.mark.data


def test_real_counts(datasets_root, tmp_path):
    meta = build_catalog(datasets_root, tmp_path)
    assert meta["counts"]["by_source"] == {
        "mpx": 5809, "flopp": 186, "flopp_e": 195, "slopp": 148, "slopp_e": 113,
        "raspi": 402, "raman_weathered": 173}
    df = load_catalog(tmp_path / "spectra_catalog.parquet")
    sel = df[(df.source == "mpx") & (df.technique == "raman") & (df.polymer == "PE")
             & (df.state == "weathered")]
    assert len(sel) > 0
    grid = GRIDS["raman"]
    y = grid_matrix(sel)
    peak = grid[np.nanargmax(np.where(np.isfinite(y), y, -np.inf), axis=1)]
    frac = np.mean((peak >= 2800) & (peak <= 2950))
    assert frac >= 0.8, f"only {frac:.0%} of PE weathered peaks in 2800-2950"
