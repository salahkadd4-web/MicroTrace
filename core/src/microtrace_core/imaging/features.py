"""Multi-scale pixel descriptors (numpy and scipy only)."""
from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi

SIGMAS = (1, 2, 4, 8, 16)
BACKGROUND_SIGMA = 64
N_FEATURES = 23  # intensity + 4 per sigma + 2 background descriptors


def normalise(gray: np.ndarray) -> np.ndarray:
    """Stretch between the 1st and 99th percentiles into [0, 1] (float32)."""
    g = np.asarray(gray, dtype=np.float32)
    lo, hi = np.percentile(g, [1, 99])
    if not hi > lo:
        return np.zeros(g.shape, dtype=np.float32)
    return np.clip((g - lo) / (hi - lo), 0.0, 1.0).astype(np.float32)


def _gauss(a: np.ndarray, sigma: float) -> np.ndarray:
    return ndi.gaussian_filter(a, sigma, mode="reflect")


def pixel_features(img: np.ndarray) -> np.ndarray:
    """(h, w, 23) float32: intensity; per sigma the smoothed value, gradient magnitude,
    laplacian and local standard deviation; then intensity minus a sigma-64 background and
    its smoothed absolute value (sigma 4)."""
    a = np.ascontiguousarray(img, dtype=np.float32)
    h, w = a.shape
    out = np.empty((h, w, N_FEATURES), dtype=np.float32)
    out[..., 0] = a
    sq = a * a
    k = 1
    for sigma in SIGMAS:
        mean = _gauss(a, sigma)
        out[..., k] = mean
        out[..., k + 1] = ndi.gaussian_gradient_magnitude(a, sigma, mode="reflect")
        out[..., k + 2] = ndi.gaussian_laplace(a, sigma, mode="reflect")
        var = _gauss(sq, sigma) - mean * mean
        out[..., k + 3] = np.sqrt(np.maximum(var, 0.0))
        k += 4
    diff = a - _gauss(a, BACKGROUND_SIGMA)
    out[..., k] = diff
    out[..., k + 1] = _gauss(np.abs(diff), 4)
    return out
