"""Spectral model s1: correlation on the diagnostic window plus a PCA+SVM second opinion.

Inference is pure numpy; scikit-learn is only used at training time (``train``).
"""
from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

import numpy as np

from microtrace_core.preprocess import (
    DIAGNOSTIC_WINDOWS,
    GRIDS,
    diagnostic_coverage,
    preprocess,
)
from microtrace_core.spectral.libraries import LIBRARIES
from microtrace_core.spectral.matching import correlation_matrix
from microtrace_core.spectral.thresholds import Status, Thresholds, round12, status_of
from microtrace_core.spectrum import Spectrum, Technique, XUnit, YUnit

__all__ = [
    "Abstention", "Candidate", "Identification", "Reference", "SpectralModel",
    "SpectralQuery", "Status", "SvmParams", "TechniqueModel", "identify", "pca_transform",
    "svm_predict", "window_mask",
]

MIN_COVERAGE = 0.8
MIN_OVERLAP = 0.5
PCA_COMPONENTS = 30
N_CANDIDATES = 3
N_REFERENCES = 5
TECHNIQUE_MISMATCH_MARGIN = 0.10
PLOT_STRIDE = 2
LASER_NM_RANGE = (200.0, 1100.0)


class Abstention(StrEnum):
    LOW_SCORE = "low_score"
    LOW_COVERAGE = "low_coverage"
    TECHNIQUE_MISMATCH = "technique_mismatch"
    NO_OVERLAP = "no_overlap"


@dataclass(frozen=True, eq=False)
class SvmParams:
    classes: np.ndarray
    support_vectors: np.ndarray
    dual_coef: np.ndarray
    intercept: np.ndarray
    n_support: np.ndarray
    gamma: float


@dataclass(frozen=True, eq=False)
class TechniqueModel:
    technique: Technique
    refs: np.ndarray  # (n, n_window) float32, NaN kept
    plot: np.ndarray  # (n, n_plot) float16, on GRIDS[t][::PLOT_STRIDE]
    plot_x: np.ndarray
    ids: np.ndarray
    labels: np.ndarray
    sources: np.ndarray
    pca_mean: np.ndarray
    pca_components: np.ndarray
    svm: SvmParams
    thresholds: Thresholds


@dataclass(frozen=True, eq=False)
class SpectralModel:
    name: str
    version: str
    techniques: Mapping[Technique, TechniqueModel]
    meta: Mapping[str, object]


@dataclass(frozen=True, eq=False)
class SpectralQuery:
    x: np.ndarray
    y: np.ndarray
    technique: Technique
    x_unit: XUnit
    y_unit: YUnit
    laser_nm: float | None


@dataclass(frozen=True)
class Candidate:
    polymer: str
    score: float


@dataclass(frozen=True, eq=False)
class Reference:
    spectrum_id: str
    library: str
    polymer: str
    score: float
    curve: tuple[np.ndarray, np.ndarray] | None


@dataclass(frozen=True, eq=False)
class Identification:
    status: Status
    abstention: Abstention | None
    coverage: float
    candidates: tuple[Candidate, ...]
    margin: float | None
    classifier: str | None
    references: tuple[Reference, ...]
    query_curve: tuple[np.ndarray, np.ndarray]
    other_technique: Technique | None
    other_technique_score: float | None
    thresholds: Thresholds


def window_mask(technique: Technique) -> np.ndarray:
    lo, hi = DIAGNOSTIC_WINDOWS[technique]
    grid = GRIDS[technique]
    return (grid >= lo) & (grid <= hi)


def pca_transform(mean: np.ndarray, components: np.ndarray, X: np.ndarray) -> np.ndarray:
    return (np.nan_to_num(np.asarray(X, dtype=np.float64)) - mean) @ components.T


def svm_predict(p: SvmParams, Z: np.ndarray) -> np.ndarray:
    """libsvm one-vs-one RBF decision: pairwise votes, first maximum wins."""
    Z = np.asarray(Z, dtype=np.float64)
    k = len(p.classes)
    if k == 1:
        return np.repeat(p.classes[:1], len(Z))
    sv = p.support_vectors
    d2 = (Z**2).sum(1)[:, None] + (sv**2).sum(1)[None, :] - 2.0 * (Z @ sv.T)
    kernel = np.exp(-p.gamma * np.maximum(d2, 0.0))
    start = np.concatenate([[0], np.cumsum(p.n_support)]).astype(int)
    votes = np.zeros((len(Z), k), dtype=np.int64)
    pair = 0
    for i in range(k):
        for j in range(i + 1, k):
            si, sj = slice(start[i], start[i + 1]), slice(start[j], start[j + 1])
            dec = (kernel[:, si] @ p.dual_coef[j - 1, si]
                   + kernel[:, sj] @ p.dual_coef[i, sj] + p.intercept[pair])
            votes[:, i] += dec > 0
            votes[:, j] += dec <= 0
            pair += 1
    return p.classes[np.argmax(votes, axis=1)]


def polymer_scores(S: np.ndarray, labels: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Best correlation per polymer: (sorted polymer names, (n_q, n_polymers), -inf if none)."""
    classes = np.unique(labels)
    P = np.full((S.shape[0], len(classes)), -np.inf)
    for c, name in enumerate(classes):
        P[:, c] = S[:, labels == name].max(axis=1)
    return classes, P


def ranked_polymers(classes: np.ndarray, row: np.ndarray) -> list[tuple[str, float]]:
    """Polymers with a finite score, best first (ties: alphabetical)."""
    order = np.argsort(-row, kind="stable")
    return [(str(classes[i]), float(row[i])) for i in order if np.isfinite(row[i])]


def technique_mismatch(s1: float | None, other_score: float | None,
                       other_coverage: float | None, other_thresholds: Thresholds | None) -> bool:
    """True when the spectrum fits the other technique clearly better (design 4.3)."""
    if (s1 is None or other_score is None or other_coverage is None
            or other_thresholds is None or not math.isfinite(s1)
            or not math.isfinite(other_score)):
        return False
    if other_coverage < MIN_COVERAGE:
        return False
    other = round12(other_score)
    if other < other_thresholds.uncertain_min_score:
        return False
    return round12(other - round12(s1)) >= TECHNIQUE_MISMATCH_MARGIN


OTHER: dict[Technique, Technique] = {"raman": "ftir_atr", "ftir_atr": "raman"}


def guard_eligible(x_unit: str, y_unit: str) -> bool:
    return x_unit == "cm-1" and y_unit != "transmittance_pct"


def other_technique_spectrum(technique: Technique, x: np.ndarray, y: np.ndarray) -> Spectrum:
    """The same x/y (cm-1) read as the other technique."""
    other = OTHER[technique]
    return Spectrum(
        spectrum_id="query", source="query", technique=other, x=x, y=y,
        x_unit="cm-1", polymer="UNKNOWN", polymer_raw="", state="unknown",
        sample_group="query", file="query", laser_nm=None,
        y_unit="intensity" if other == "raman" else "absorbance")


def best_score(tm: TechniqueModel, y_grid: np.ndarray, technique: Technique) -> float | None:
    window = np.asarray(y_grid, dtype=np.float64)[window_mask(technique)]
    s = correlation_matrix(window[None, :], tm.refs, MIN_OVERLAP)[0]
    return float(s.max()) if np.isfinite(s).any() else None


def _query_curve(y_grid: np.ndarray, technique: Technique) -> tuple[np.ndarray, np.ndarray]:
    x = GRIDS[technique][::PLOT_STRIDE]
    y = np.asarray(y_grid, dtype=np.float64)[::PLOT_STRIDE]
    ok = np.isfinite(y)
    return x[ok], y[ok]


def _reference_curve(tm: TechniqueModel, i: int) -> tuple[np.ndarray, np.ndarray] | None:
    lib = LIBRARIES.get(str(tm.sources[i]))
    if lib is None or not lib.curve_allowed:
        return None
    y = tm.plot[i].astype(np.float64)
    ok = np.isfinite(y)
    return tm.plot_x[ok].astype(np.float64), y[ok]


def identify(model: SpectralModel, q: SpectralQuery) -> Identification:
    """Propose polymers for one spectrum, or abstain (design 4.1 to 4.4)."""
    tm = model.techniques[q.technique]
    if q.laser_nm is not None and not (LASER_NM_RANGE[0] <= q.laser_nm <= LASER_NM_RANGE[1]):
        raise ValueError("laser_nm out of range")
    spectrum = Spectrum(
        spectrum_id="query", source="query", technique=q.technique, x=q.x, y=q.y,
        x_unit=q.x_unit, polymer="UNKNOWN", polymer_raw="", state="unknown",
        sample_group="query", file="query", laser_nm=q.laser_nm, y_unit=q.y_unit)
    y_grid = preprocess(spectrum)
    coverage = diagnostic_coverage(y_grid, q.technique)
    curve = _query_curve(y_grid, q.technique)

    def abstain(reason: Abstention) -> Identification:
        return Identification(
            status=Status.NOT_IDENTIFIED, abstention=reason, coverage=coverage,
            candidates=(), margin=None, classifier=None, references=(),
            query_curve=curve, other_technique=None, other_technique_score=None,
            thresholds=tm.thresholds)

    if coverage < MIN_COVERAGE:
        return abstain(Abstention.LOW_COVERAGE)

    window = np.asarray(y_grid, dtype=np.float64)[window_mask(q.technique)]
    scores = correlation_matrix(window[None, :], tm.refs, MIN_OVERLAP)[0]
    if not np.isfinite(scores).any():
        return abstain(Abstention.NO_OVERLAP)

    classes, P = polymer_scores(scores[None, :], tm.labels)
    ranked = ranked_polymers(classes, P[0])
    candidates = tuple(Candidate(p, round12(s)) for p, s in ranked[:N_CANDIDATES])
    s1 = ranked[0][1]
    s2 = ranked[1][1] if len(ranked) > 1 else None
    margin = None if s2 is None else round12(round12(s1) - round12(s2))

    order = np.argsort(-scores, kind="stable")
    references = tuple(
        Reference(str(tm.ids[i]), str(tm.sources[i]), str(tm.labels[i]),
                  round12(float(scores[i])), _reference_curve(tm, int(i)))
        for i in order[:N_REFERENCES] if np.isfinite(scores[i]))

    classifier = str(svm_predict(
        tm.svm, pca_transform(tm.pca_mean, tm.pca_components, window[None, :]))[0])

    common = dict(coverage=coverage, candidates=candidates, margin=margin,
                  classifier=classifier, references=references, query_curve=curve)

    other_t = OTHER[q.technique]
    if guard_eligible(q.x_unit, q.y_unit) and other_t in model.techniques:
        other_tm = model.techniques[other_t]
        other_grid = preprocess(other_technique_spectrum(q.technique, q.x, q.y))
        other_cov = diagnostic_coverage(other_grid, other_t)
        other_score = best_score(other_tm, other_grid, other_t) if other_cov >= MIN_COVERAGE else None
        if technique_mismatch(s1, other_score, other_cov, other_tm.thresholds):
            return Identification(
                status=Status.NOT_IDENTIFIED, abstention=Abstention.TECHNIQUE_MISMATCH,
                other_technique=other_t, other_technique_score=round12(other_score),
                thresholds=tm.thresholds, **common)

    status = status_of(s1, s2, candidates[0].polymer, classifier, tm.thresholds)
    abstention = Abstention.LOW_SCORE if status == Status.NOT_IDENTIFIED else None
    return Identification(status=status, abstention=abstention, other_technique=None,
                          other_technique_score=None, thresholds=tm.thresholds, **common)
