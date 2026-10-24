"""Spectral preprocessing: unit conversion, resampling, baseline removal, scaling."""
from __future__ import annotations

import numpy as np
from scipy import sparse
from scipy.sparse.linalg import spsolve

from microtrace_core.spectrum import Spectrum, Technique

PREPROCESS_VERSION = "2"

GRIDS: dict[Technique, np.ndarray] = {
    "ftir_atr": np.arange(600, 4001, 4.0),
    "raman": np.arange(250, 3201, 4.0),
}

# Spectral window (cm-1, bounds included) on which identification coverage is judged.
DIAGNOSTIC_WINDOWS: dict[Technique, tuple[float, float]] = {
    "raman": (400.0, 1800.0),
    "ftir_atr": (600.0, 1800.0),
}

_ALS_PARAMS: dict[Technique, tuple[float, float]] = {
    "raman": (1e5, 0.01),
    "ftir_atr": (1e6, 0.01),
}


def nm_to_raman_shift(wavelength_nm: np.ndarray, laser_nm: float) -> np.ndarray:
    """Convert absolute wavelengths (nm) to Raman shift (cm-1)."""
    wl = np.asarray(wavelength_nm, dtype=np.float64)
    return 1e7 / laser_nm - 1e7 / wl


def transmittance_to_absorbance(t_pct: np.ndarray) -> np.ndarray:
    """A = -log10(T/100); T <= 0 or non-finite (zero padding) becomes NaN."""
    t = np.asarray(t_pct, dtype=np.float64)
    out = np.full(t.shape, np.nan)
    ok = np.isfinite(t) & (t > 0)
    out[ok] = -np.log10(t[ok] / 100.0)
    return out


def clean(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Drop non-finite pairs, sort x ascending and average duplicated x values."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    mask = np.isfinite(x) & np.isfinite(y)
    x, y = x[mask], y[mask]
    if x.size == 0:
        return x, y
    ux, inverse = np.unique(x, return_inverse=True)
    sums = np.bincount(inverse, weights=y, minlength=len(ux))
    counts = np.bincount(inverse, minlength=len(ux))
    return ux, sums / counts


def resample(x: np.ndarray, y: np.ndarray, grid: np.ndarray) -> np.ndarray:
    """Linear interpolation onto grid; NaN outside [x.min(), x.max()]."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    grid = np.asarray(grid, dtype=np.float64)
    if x.size < 2:
        return np.full(grid.shape, np.nan)
    out = np.interp(grid, x, y)
    out[(grid < x.min()) | (grid > x.max())] = np.nan
    return out


def als_baseline(y: np.ndarray, lam: float, p: float, n_iter: int = 10) -> np.ndarray:
    """Asymmetric least squares baseline (Eilers), computed on the finite part only."""
    y = np.asarray(y, dtype=np.float64)
    out = np.full(y.shape, np.nan)
    finite = np.isfinite(y)
    n = int(finite.sum())
    if n == 0:
        return out
    yf = y[finite]
    if n < 3:
        out[finite] = yf
        return out
    d = sparse.diags([1.0, -2.0, 1.0], [0, 1, 2], shape=(n - 2, n), format="csc")
    penalty = lam * (d.T @ d)
    w = np.ones(n)
    z = yf
    for _ in range(n_iter):
        z = spsolve((sparse.diags(w) + penalty).tocsc(), w * yf)
        w = p * (yf > z) + (1 - p) * (yf < z)
    out[finite] = z
    return out


def minmax(y: np.ndarray) -> np.ndarray:
    """Scale to [0, 1] ignoring NaN; a constant signal gives zeros."""
    y = np.asarray(y, dtype=np.float64)
    out = np.full(y.shape, np.nan)
    finite = np.isfinite(y)
    if not finite.any():
        return out
    lo, hi = y[finite].min(), y[finite].max()
    if hi == lo:
        out[finite] = 0.0
    else:
        out[finite] = (y[finite] - lo) / (hi - lo)
    return out


def coverage(y_grid: np.ndarray) -> float:
    """Fraction of finite points."""
    y_grid = np.asarray(y_grid)
    if y_grid.size == 0:
        return 0.0
    return float(np.isfinite(y_grid).sum() / y_grid.size)


def diagnostic_coverage(y_grid: np.ndarray, technique: Technique) -> float:
    """Fraction of finite points within the technique's diagnostic window."""
    y_grid = np.asarray(y_grid)
    grid = GRIDS[technique]
    if y_grid.shape != grid.shape:
        raise ValueError(
            f"y_grid has {y_grid.size} points, the {technique} grid has {grid.size}")
    lo, hi = DIAGNOSTIC_WINDOWS[technique]
    in_window = (grid >= lo) & (grid <= hi)
    return float(np.isfinite(y_grid[in_window]).sum() / in_window.sum())


def preprocess(s: Spectrum) -> np.ndarray:
    """Full pipeline to a float32 vector on the technique grid (input is not modified)."""
    x = s.x
    if s.x_unit == "nm":
        x = nm_to_raman_shift(x, s.laser_nm)
    y = s.y
    if s.y_unit == "transmittance_pct":
        y = transmittance_to_absorbance(y)
    x, y = clean(x, y)
    grid = GRIDS[s.technique]
    y_grid = resample(x, y, grid)
    lam, p = _ALS_PARAMS[s.technique]
    y_grid = y_grid - als_baseline(y_grid, lam=lam, p=p)
    return minmax(y_grid).astype(np.float32)
