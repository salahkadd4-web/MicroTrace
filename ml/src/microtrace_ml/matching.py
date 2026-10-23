"""Pearson-correlation library matcher with partial spectral overlap."""

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
        self._mask = np.isfinite(Y)
        self._Y = np.where(self._mask, Y, 0.0)
        self._maskf = self._mask.astype(np.float64)
        self._Y2 = self._Y**2
        self._labels = np.array([str(v) for v in labels], dtype=object)
        self._ids = np.array([str(v) for v in ids], dtype=object)
        return self

    def predict(
        self, Q: np.ndarray, threshold: float = 0.0, chunk_size: int = 256
    ) -> MatchResult:
        Q = np.asarray(Q, dtype=np.float64)
        if Q.ndim != 2 or Q.shape[1] != self._Y.shape[1]:
            raise ValueError("Q must be 2-D with the same number of points as the library")
        n_q = len(Q)
        scores = np.full(n_q, -np.inf)
        best = np.zeros(n_q, dtype=np.intp)
        for start in range(0, n_q, chunk_size):
            s, b = self._predict_chunk(Q[start : start + chunk_size])
            scores[start : start + chunk_size] = s
            best[start : start + chunk_size] = b

        labels = self._labels[best].copy()
        ids = self._ids[best].copy()
        reject = ~(scores >= threshold)  # also catches -inf with threshold <= -inf
        reject |= np.isneginf(scores)
        labels[reject] = NO_MATCH
        ids[reject] = ""
        return MatchResult(labels=labels, scores=scores, best_ids=ids)

    def _predict_chunk(self, Q: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        mq = np.isfinite(Q)
        mqf = mq.astype(np.float64)
        X = np.where(mq, Q, 0.0)
        n = mqf @ self._maskf.T
        sx = X @ self._maskf.T
        sy = mqf @ self._Y.T
        sxy = X @ self._Y.T
        sxx = (X**2) @ self._maskf.T
        syy = mqf @ self._Y2.T

        min_n = self.min_overlap * self._Y.shape[1]
        valid = (n >= min_n) & (n >= 2)
        n_safe = np.where(valid, n, 1.0)
        cov = sxy - sx * sy / n_safe
        vx = sxx - sx**2 / n_safe
        vy = syy - sy**2 / n_safe
        valid &= (vx > _REL_VAR_EPS * sxx) & (vy > _REL_VAR_EPS * syy)
        denom = np.where(valid, vx * vy, 1.0)
        corr = np.where(valid, np.clip(cov / np.sqrt(denom), -1.0, 1.0), -np.inf)
        best = np.argmax(corr, axis=1)
        return corr[np.arange(len(corr)), best], best
