"""Pearson-correlation library matcher with partial spectral overlap.

Moved unchanged from ``microtrace_ml.matching`` (which re-exports it); the full
score matrix is exposed as :func:`correlation_matrix` for spectral identification.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

NO_MATCH = "NO_MATCH"

# A variance below this fraction of the raw second moment is treated as zero.
_REL_VAR_EPS = 1e-10


@dataclass
class MatchResult:
    labels: np.ndarray  # object array of str
    scores: np.ndarray  # float64, -inf when no valid pair
    best_ids: np.ndarray  # object array of str; "" when no valid pair


class _Reference:
    """Precomputed sums of a reference matrix (NaN = missing point)."""

    def __init__(self, R: np.ndarray):
        R = np.asarray(R, dtype=np.float64)
        self.n_points = R.shape[1]
        self.mask = np.isfinite(R)
        self.Y = np.where(self.mask, R, 0.0)
        self.maskf = self.mask.astype(np.float64)
        self.Y2 = self.Y**2


def _correlation_block(Q: np.ndarray, ref: _Reference, min_overlap: float) -> np.ndarray:
    mq = np.isfinite(Q)
    mqf = mq.astype(np.float64)
    X = np.where(mq, Q, 0.0)
    n = mqf @ ref.maskf.T
    sx = X @ ref.maskf.T
    sy = mqf @ ref.Y.T
    sxy = X @ ref.Y.T
    sxx = (X**2) @ ref.maskf.T
    syy = mqf @ ref.Y2.T

    min_n = min_overlap * ref.n_points
    valid = (n >= min_n) & (n >= 2)
    n_safe = np.where(valid, n, 1.0)
    cov = sxy - sx * sy / n_safe
    vx = sxx - sx**2 / n_safe
    vy = syy - sy**2 / n_safe
    valid &= (vx > _REL_VAR_EPS * sxx) & (vy > _REL_VAR_EPS * syy)
    denom = np.where(valid, vx * vy, 1.0)
    return np.where(valid, np.clip(cov / np.sqrt(denom), -1.0, 1.0), -np.inf)


def correlation_matrix(Q: np.ndarray, R: np.ndarray, min_overlap: float = 0.5) -> np.ndarray:
    """Pearson correlation of every query row with every reference row, shape (n_q, n_r).

    Only jointly finite points count. A pair with fewer than ``min_overlap * n_points``
    such points, or with zero variance on the overlap, scores ``-inf``.
    """
    Q = np.asarray(Q, dtype=np.float64)
    R = np.asarray(R, dtype=np.float64)
    if Q.ndim != 2 or R.ndim != 2 or Q.shape[1] != R.shape[1]:
        raise ValueError("Q and R must be 2-D with the same number of points")
    return _correlation_block(Q, _Reference(R), min_overlap)


class CorrelationMatcher:
    """Nearest reference by Pearson correlation over jointly finite points.

    A pair with fewer than ``min_overlap * n_points`` jointly finite points, or
    with zero variance on the overlap, scores ``-inf``.
    """

    def __init__(self, min_overlap: float = 0.5):
        self.min_overlap = min_overlap

    def fit(
        self, Y: np.ndarray, labels: Sequence[str], ids: Sequence[str]
    ) -> CorrelationMatcher:
        Y = np.asarray(Y, dtype=np.float64)
        if Y.ndim != 2 or not (len(Y) == len(labels) == len(ids)):
            raise ValueError("Y must be 2-D with one label and one id per row")
        self._ref = _Reference(Y)
        self._labels = np.array([str(v) for v in labels], dtype=object)
        self._ids = np.array([str(v) for v in ids], dtype=object)
        return self

    def predict(
        self, Q: np.ndarray, threshold: float = 0.0, chunk_size: int = 256
    ) -> MatchResult:
        Q = np.asarray(Q, dtype=np.float64)
        if Q.ndim != 2 or Q.shape[1] != self._ref.n_points:
            raise ValueError("Q must be 2-D with the same number of points as the library")
        n_q = len(Q)
        scores = np.full(n_q, -np.inf)
        best = np.zeros(n_q, dtype=np.intp)
        for start in range(0, n_q, chunk_size):
            corr = _correlation_block(Q[start : start + chunk_size], self._ref, self.min_overlap)
            b = np.argmax(corr, axis=1)
            scores[start : start + chunk_size] = corr[np.arange(len(corr)), b]
            best[start : start + chunk_size] = b

        labels = self._labels[best].copy()
        ids = self._ids[best].copy()
        reject = ~(scores >= threshold)  # also catches -inf with threshold <= -inf
        reject |= np.isneginf(scores)
        labels[reject] = NO_MATCH
        ids[reject] = ""
        return MatchResult(labels=labels, scores=scores, best_ids=ids)
