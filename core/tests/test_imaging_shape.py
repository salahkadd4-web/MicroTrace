"""Shape classifier: numpy softmax equals scikit-learn, rules, film never proposed."""
from __future__ import annotations

import numpy as np
import pytest
from skimage.measure import label
from sklearn.linear_model import LogisticRegression

from microtrace_core.imaging.geometry import particles_from_labels
from microtrace_core.imaging.shape import (
    SHAPES,
    UNEVALUATED_SHAPES,
    ShapeModel,
    rule_shape,
    shape_features,
    shape_proba,
)

from imaging_fixtures import discs_image, rect_image, threshold_model


def _first(img):
    return particles_from_labels(label(img > 0, connectivity=2))[0]


def test_shape_proba_matches_sklearn():
    rng = np.random.default_rng(0)
    X = np.vstack([rng.normal(m, 1.0, (60, 6)) for m in (-1.5, 0.0, 1.5)])
    y = np.repeat(["bille", "fibre", "fragment"], 60)
    mean, scale = X.mean(0), X.std(0)
    lr = LogisticRegression(C=1, class_weight="balanced", max_iter=1000, random_state=0)
    lr.fit((X - mean) / scale, y)
    model = ShapeModel(mean, scale, lr.coef_, lr.intercept_, tuple(lr.classes_))
    Xt = rng.normal(0, 2.0, (200, 6))
    got = shape_proba(model, Xt)
    assert got.shape == (200, 3)
    assert np.abs(got - lr.predict_proba((Xt - mean) / scale)).max() < 1e-9
    assert np.allclose(got.sum(1), 1.0)


def test_shape_features_order_and_values():
    disc = _first(discs_image(200, 200, [(100, 100, 40)]))
    f = shape_features(disc)
    assert f.shape == (6,) and f.dtype == np.float64
    assert f[0] == pytest.approx(disc.circularity) and f[1] == pytest.approx(disc.solidity)
    assert f[2] == pytest.approx(np.log(disc.aspect)) and f[3] == pytest.approx(
        np.log(disc.elongation))
    assert f[4] == pytest.approx(disc.extent) and f[5] == pytest.approx(disc.eccentricity)
    assert np.isfinite(shape_features(_first(rect_image(100, 300, 40, 10, 2, 250)))).all()


def test_rule_shape_reference():
    assert rule_shape(_first(rect_image(200, 300, 90, 30, 8, 200))) == "fibre"
    assert rule_shape(_first(discs_image(200, 200, [(100, 100, 40)]))) == "bille"
    square = _first(rect_image(200, 200, 50, 50, 60, 75))
    assert rule_shape(square) == "fragment"


def test_shape_vocabulary_and_film_never_in_a_model():
    assert SHAPES == ("fibre", "fragment", "bille") and UNEVALUATED_SHAPES == ("film",)
    model = threshold_model().shape
    assert "film" not in model.classes
    p = shape_proba(model, np.random.default_rng(1).normal(size=(50, 6)))
    assert p.shape[1] == len(model.classes) == 3


def test_binary_model_is_supported():
    m = ShapeModel(np.zeros(6), np.ones(6), np.array([[1.0, 0, 0, 0, 0, 0]]), np.array([0.0]),
                   ("fibre", "bille"))
    p = shape_proba(m, np.array([[2.0, 0, 0, 0, 0, 0]]))
    assert p.shape == (1, 2) and p[0, 1] == pytest.approx(1 / (1 + np.exp(-2.0)))
