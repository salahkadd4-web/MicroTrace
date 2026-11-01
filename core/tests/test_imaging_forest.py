"""Pixel features and the numpy forest."""
from __future__ import annotations

import numpy as np
from sklearn.ensemble import RandomForestClassifier

from microtrace_core.imaging import features as ft
from microtrace_core.imaging.forest import Forest, forest_from_sklearn, forest_proba


def _data(n: int, seed: int):
    rng = np.random.default_rng(seed)
    X = rng.normal(size=(n, 23)).astype(np.float32)
    y = ((X[:, 0] + 0.5 * X[:, 3] * X[:, 7] + 0.3 * rng.normal(size=n)) > 0).astype(int)
    return X, y


def test_forest_matches_sklearn():
    X, y = _data(2000, 0)
    rf = RandomForestClassifier(n_estimators=7, max_depth=6, random_state=0).fit(X, y)
    forest = forest_from_sklearn(rf)
    Xt, _ = _data(5000, 1)
    got = forest_proba(forest, Xt)
    assert got.dtype == np.float32 and got.shape == (5000,)
    assert np.abs(got - rf.predict_proba(Xt)[:, 1]).max() < 1e-6


def test_forest_matches_sklearn_with_ties_on_split_values():
    """Thresholds are floored to float32: points on a threshold go the sklearn way."""
    rng = np.random.default_rng(0)
    X = rng.integers(0, 6, size=(1500, 23)).astype(np.float32) / 7.0  # many repeated values
    y = (X[:, 0] + X[:, 1] > 0.5).astype(int)
    rf = RandomForestClassifier(n_estimators=5, max_depth=8, min_samples_leaf=20,
                                class_weight="balanced", random_state=0).fit(X, y)
    forest = forest_from_sklearn(rf)
    assert np.abs(forest_proba(forest, X) - rf.predict_proba(X)[:, 1]).max() < 1e-6


def test_forest_layout_and_chunking():
    X, y = _data(800, 2)
    rf = RandomForestClassifier(n_estimators=3, max_depth=5, random_state=0).fit(X, y)
    f = forest_from_sklearn(rf)
    n = len(f.feature)
    assert f.feature.dtype == np.int16 and f.threshold.dtype == np.float32
    assert f.left.dtype == f.right.dtype == f.roots.dtype == np.int32
    assert f.value.dtype == np.float32 and len(f.roots) == 3
    assert f.roots[0] == 0 and np.all(np.diff(f.roots) > 0) and f.roots[-1] < n
    assert (f.feature < 0).sum() >= 3 and f.max_depth <= 5
    big = np.tile(X, (200, 1))  # more rows than one chunk
    p = forest_proba(f, big)
    assert np.array_equal(p[:800], p[800:1600])


def test_normalise_and_features_shape():
    g = np.tile(np.linspace(10, 200, 160), (96, 1)).astype(np.uint8)
    n = ft.normalise(g)
    assert n.dtype == np.float32 and n.shape == g.shape
    assert n.min() >= 0.0 and n.max() <= 1.0
    assert np.all(ft.normalise(np.full((64, 64), 128, np.uint8)) == 0)
    F = ft.pixel_features(n)
    assert F.shape == (96, 160, ft.N_FEATURES) and F.dtype == np.float32
    assert ft.N_FEATURES == 23 and ft.SIGMAS == (1, 2, 4, 8, 16) and ft.BACKGROUND_SIGMA == 64
    assert np.array_equal(F[..., 0], n)
    assert np.isfinite(F).all()


def test_features_are_deterministic_and_respond_to_edges():
    img = np.zeros((96, 96), np.float32)
    img[:, 48:] = 1.0
    F = ft.pixel_features(img)
    grad = F[..., 1 + 4 * 1 + 1]  # gradient magnitude at sigma 2
    assert grad[48, 47:49].max() > grad[48, 10]
    assert np.array_equal(F, ft.pixel_features(img))


def test_forest_on_no_rows():
    f = Forest(feature=np.array([-1], np.int16), threshold=np.zeros(1, np.float32),
               left=np.zeros(1, np.int32), right=np.zeros(1, np.int32),
               value=np.array([0.25], np.float32), roots=np.zeros(1, np.int32), max_depth=0)
    assert forest_proba(f, np.zeros((0, 23), np.float32)).shape == (0,)
    assert forest_proba(f, np.zeros((3, 23), np.float32)).tolist() == [0.25, 0.25, 0.25]
