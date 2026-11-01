"""Contours, Feret calipers, particle descriptors."""
from __future__ import annotations

import numpy as np
import pytest
from skimage.measure import label

from microtrace_core.imaging.geometry import MAX_CONTOUR_POINTS, feret, particles_from_labels

from imaging_fixtures import discs_image, rect_image


def _labels(img: np.ndarray) -> np.ndarray:
    return label(img > 0, connectivity=2)


def test_feret_square_and_rectangle():
    sq = particles_from_labels(_labels(rect_image(300, 300, 50, 50, 100, 100)))[0]
    assert sq.feret_max_px == pytest.approx(141.4, abs=1.5)
    assert sq.feret_min_px == pytest.approx(100.0, abs=1.5)
    rc = particles_from_labels(_labels(rect_image(300, 400, 100, 50, 10, 200)))[0]
    assert rc.feret_max_px == pytest.approx(200.2, abs=1.0)
    assert rc.feret_min_px == pytest.approx(10.0, abs=1.0)


def test_feret_rotating_calipers_on_known_polygons():
    mx, mn = feret(np.array([[0, 0], [4, 0], [4, 3], [0, 3]], float))
    assert mx == pytest.approx(5.0) and mn == pytest.approx(3.0)
    mx, mn = feret(np.array([[0, 0], [2, 0], [1, np.sqrt(3)]], float))
    assert mx == pytest.approx(2.0) and mn == pytest.approx(np.sqrt(3))
    assert feret(np.array([[1.0, 1.0]])) == (0.0, 0.0)
    assert feret(np.array([[0.0, 0.0], [3.0, 4.0]])) == (5.0, 0.0)
    assert feret(np.array([[0.0, 0.0], [1.0, 1.0], [2.0, 2.0]])) == (pytest.approx(8 ** 0.5), 0.0)


def test_particles_ids_by_area_and_border():
    img = discs_image(200, 300, [(60, 60, 30), (130, 200, 20), (190, 270, 10)])
    ps = particles_from_labels(_labels(img))
    assert [p.id for p in ps] == [1, 2, 3]
    assert [p.touches_border for p in ps] == [False, False, True]
    assert ps[0].area_px > ps[1].area_px > ps[2].area_px
    for p in ps:
        assert 4 <= len(p.contour) <= MAX_CONTOUR_POINTS
        assert p.contour[0] == p.contour[-1]
        x0, y0, x1, y1 = p.bbox
        xs = [c[0] for c in p.contour]
        ys = [c[1] for c in p.contour]
        assert x0 - 1 <= min(xs) and max(xs) <= x1 + 1
        assert y0 - 1 <= min(ys) and max(ys) <= y1 + 1


def test_disc_descriptors():
    p = particles_from_labels(_labels(discs_image(200, 200, [(100, 100, 40)])))[0]
    assert p.feret_max_px == pytest.approx(80, abs=2) and p.feret_min_px == pytest.approx(80, abs=2)
    assert p.eq_diameter_px == pytest.approx(80, abs=1.5)
    assert p.circularity > 0.9 and p.solidity > 0.98 and p.aspect < 1.1
    assert p.elongation < 1.3 and p.eccentricity < 0.3
    assert p.extent == pytest.approx(0.785, abs=0.03)


def test_thin_rectangle_is_elongated():
    p = particles_from_labels(_labels(rect_image(200, 300, 90, 30, 8, 200)))[0]
    assert p.elongation > 10 and p.aspect > 10 and p.circularity < 0.3
    assert p.eccentricity > 0.99


def test_contour_is_simplified_to_the_limit():
    p = particles_from_labels(_labels(discs_image(1000, 1000, [(500, 500, 450)])))[0]
    assert len(p.contour) <= MAX_CONTOUR_POINTS and p.contour[0] == p.contour[-1]
    d = np.hypot(np.array([c[0] for c in p.contour]) - 500,
                 np.array([c[1] for c in p.contour]) - 500)
    assert np.abs(d - 450).max() < 3


def test_empty_labels_and_limit():
    assert particles_from_labels(np.zeros((50, 50), int)) == []
    img = discs_image(300, 300, [(50, 50, 10), (150, 150, 30), (250, 250, 20)])
    ps = particles_from_labels(_labels(img), limit=2)
    assert len(ps) == 2 and ps[0].area_px > ps[1].area_px


def test_equal_areas_are_ordered_deterministically():
    img = discs_image(100, 300, [(50, 50, 12), (50, 150, 12), (50, 250, 12)])
    a = particles_from_labels(_labels(img))
    assert [p.bbox for p in a] == [p.bbox for p in particles_from_labels(_labels(img))]
    assert [p.bbox[0] for p in a] == sorted(p.bbox[0] for p in a)
