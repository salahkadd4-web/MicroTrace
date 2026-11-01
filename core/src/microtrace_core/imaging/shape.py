"""Particle shape: logistic-regression classifier in numpy, plus the published reference rules."""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from microtrace_core.imaging.geometry import Particle

SHAPES = ("fibre", "fragment", "bille")
UNEVALUATED_SHAPES = ("film",)  # never proposed: absent from the training data


@dataclass(frozen=True)
class ShapeModel:
    mean: np.ndarray
    scale: np.ndarray
    coef: np.ndarray       # (classes, 6); (1, 6) for a two-class model
    intercept: np.ndarray
    classes: tuple[str, ...]


def shape_features(p: Particle) -> np.ndarray:
    """circularity, solidity, log aspect, log elongation, extent, eccentricity (no absolute size)."""
    return np.array([
        p.circularity, p.solidity, math.log(max(p.aspect, 1.0)),
        math.log(max(p.elongation, 1.0)), p.extent, p.eccentricity], dtype=np.float64)


def shape_proba(m: ShapeModel, X: np.ndarray) -> np.ndarray:
    """Class probabilities, one row per particle, columns in ``m.classes`` order."""
    X = np.atleast_2d(np.asarray(X, dtype=np.float64))
    z = (X - m.mean) / m.scale
    logits = z @ m.coef.T + m.intercept
    if m.coef.shape[0] == 1:  # two classes, scikit-learn stores one row
        logits = np.hstack([-logits / 2.0, logits / 2.0])
    logits = logits - logits.max(axis=1, keepdims=True)
    e = np.exp(logits)
    return e / e.sum(axis=1, keepdims=True)


def rule_shape(p: Particle) -> str:
    """Published reference rules (not served): elongation >= 3 is a fibre; round, compact and
    not stretched is a bead; anything else a fragment."""
    if p.elongation >= 3.0:
        return "fibre"
    if p.circularity >= 0.8 and p.solidity >= 0.95 and p.aspect <= 1.3:
        return "bille"
    return "fragment"
