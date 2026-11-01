"""Analysis: scale, abstention reasons, size classes, corrections, archive."""
from __future__ import annotations

import dataclasses
import math

import numpy as np
import pytest
from PIL import Image

from microtrace_core.imaging import IMAGE_MODEL_NAME, IMAGE_MODEL_VERSION, SEED
from microtrace_core.imaging import model as m
from microtrace_core.imaging.reading import decode_image
from microtrace_core.imaging.shape import SHAPES

from imaging_fixtures import (
    SERIAL_COMMENT,
    decoded,
    discs_image,
    png,
    rect_image,
    threshold_model,
    tiff,
    to_u8,
)


def test_constants():
    assert (IMAGE_MODEL_NAME, IMAGE_MODEL_VERSION, SEED) == ("c6-microscopie", "i1", 0)
    assert (m.ANALYSIS_MAX_SIDE, m.MAX_PARTICLES, m.MIN_CONTRAST) == (1024, 300, 10)
    assert m.SCALE_MISMATCH_TOLERANCE == 0.02
    assert m.SIZE_BINS_UM == (0, 10, 20, 50, 100, 200, 500, 1000, 5000, math.inf)
    assert m.Status.PROPOSAL == "proposal" and m.Status.UNRELIABLE == "unreliable"
    assert {r.value for r in m.Reason} == {
        "no_particle", "too_many_particles", "large_foreground", "low_contrast",
        "scale_out_of_range"}
    assert {s.value for s in m.ScaleSource} == {"metadata", "entered", "none"}


# ------------------------------------------------------------------ scale

def test_scale_resolution():
    gray = rect_image(1536, 2048, 600, 700, 200, 200)
    result = m.analyze(threshold_model(), decoded(gray), 0.5)
    assert result.analysis_size == (1024, 768) and result.downscale == pytest.approx(2.0)
    s = result.scale
    assert s.um_per_px_input == 0.5 and s.um_per_px_analysis == pytest.approx(1.0)
    assert s.source is m.ScaleSource.ENTERED
    assert result.count == 1
    p = result.particles[0].particle
    assert p.feret_min_px * s.um_per_px_analysis == pytest.approx(100.0, abs=2.0)
    assert result.analysis_gray.shape == (768, 1024) and result.analysis_gray.dtype == np.uint8


def test_scale_from_metadata_and_mismatch():
    arr = to_u8(np.tile(np.linspace(0, 255, 1280), (960, 1)))
    d = decode_image(tiff(arr, comment=SERIAL_COMMENT))
    # the brief's 1.0 is only 0.8 % from 0.9921875, inside the 2 % tolerance: 1.1 is refused
    with pytest.raises(m.ScaleMismatch) as exc:
        m.resolve_scale(d, 1.1, 1024)
    assert exc.value.entered == 1.1 and exc.value.metadata == 0.9921875
    assert m.resolve_scale(d, 1.0, 1024).source is m.ScaleSource.METADATA
    with pytest.raises(m.ScaleMismatch):
        m.resolve_scale(d, 0.9921875 * 1.021, 1024)
    near = m.resolve_scale(d, 0.995, 1024)  # 0.28 % apart
    assert near.source is m.ScaleSource.METADATA and near.um_per_px_input == 0.9921875
    assert near.um_per_px_analysis == pytest.approx(0.9921875 * 1280 / 1024)
    only_meta = m.resolve_scale(d, None, 1280)
    assert only_meta.source is m.ScaleSource.METADATA and only_meta.um_per_px_analysis == 0.9921875
    only_entered = m.resolve_scale(decoded(np.zeros((200, 300), np.uint8)), 2.0, 300)
    assert only_entered.source is m.ScaleSource.ENTERED and only_entered.um_per_px_analysis == 2.0


def test_no_scale_no_microns():
    gray = discs_image(256, 256, [(128, 128, 50)])
    result = m.analyze(threshold_model(), decoded(gray), None)
    assert result.scale is None and result.size_bins is None
    assert result.status is m.Status.PROPOSAL and result.count == 1


def test_size_bins_with_scale():
    gray = discs_image(256, 256, [(128, 128, 45)])
    result = m.analyze(threshold_model(), decoded(gray), 1.0)
    assert result.size_bins is not None and sum(b.count for b in result.size_bins) == 1
    hit = [b for b in result.size_bins if b.count][0]
    assert hit.lower == 50 and hit.upper == 100  # Feret max ~ 90 um


# ------------------------------------------------------------------ abstention

def _reasons(model, gray, scale=None):
    r = m.analyze(model, decoded(gray), scale)
    return r, set(r.reasons)


def test_abstention_reasons():
    model = threshold_model(min_area_frac=0.0005)
    uniform, reasons = _reasons(model, np.full((128, 128), 128, np.uint8))
    assert uniform.status is m.Status.UNRELIABLE and m.Reason.NO_PARTICLE in reasons
    assert uniform.count == 0

    big = np.kron(np.array([[1, 0], [0, 1]], np.uint8), np.ones((300, 300), np.uint8)) * 255
    checker, reasons = _reasons(model, big)
    assert checker.status is m.Status.UNRELIABLE and m.Reason.LARGE_FOREGROUND in reasons
    assert checker.foreground == pytest.approx(0.5, abs=0.01)

    # 400 discs of r = 14 on 1024 x 1024 (the brief's r = 6 is below the 0.05 % minimum area)
    discs = [(20 + 50 * i, 20 + 50 * j, 14 + (i + j) % 3) for i in range(20) for j in range(20)]
    many, reasons = _reasons(model, discs_image(1024, 1024, discs))
    assert m.Reason.TOO_MANY_PARTICLES in reasons and many.status is m.Status.UNRELIABLE
    assert len(many.particles) == m.MAX_PARTICLES == many.count
    areas = sorted((p.particle.area_px for p in many.particles), reverse=True)
    all_areas = sorted((math.pi * r * r for _, _, r in discs), reverse=True)
    assert areas[0] > 0.95 * all_areas[0] and areas[-1] > 0.95 * all_areas[299]  # the largest 300
    assert min(areas) > 0.9 * 615  # every r = 15 and r = 16 disc is among them
    assert [p.particle.id for p in many.particles] == list(range(1, 301))

    flat = np.full((200, 200), 100, np.uint8)
    flat[60:140, 60:140] = 106  # amplitude 6 out of 255
    low, reasons = _reasons(model, flat)
    assert m.Reason.LOW_CONTRAST in reasons and low.status is m.Status.UNRELIABLE

    far, reasons = _reasons(model, discs_image(256, 256, [(128, 128, 40)]), 40.0)
    assert reasons == {m.Reason.SCALE_OUT_OF_RANGE} and far.status is m.Status.UNRELIABLE
    assert far.scale.um_per_px_analysis == 40.0

    ok, reasons = _reasons(model, discs_image(512, 512, [(60 + 90 * i, 60 + 90 * i, 30)
                                                         for i in range(5)]))
    assert reasons == set() and ok.status is m.Status.PROPOSAL and ok.count == 5


def test_film_is_never_proposed():
    gray = rect_image(300, 600, 100, 100, 60, 400)
    result = m.analyze(threshold_model(), decoded(gray), None)
    assert result.count == 1
    sp = result.particles[0]
    assert sp.shape in SHAPES and sp.shape != "film"
    assert 0.0 < sp.shape_score <= 1.0
    assert sp.confident is (sp.shape_score >= 0.6)


def test_min_detectable_diameter_and_determinism():
    gray = discs_image(256, 256, [(128, 128, 50)])
    a = m.analyze(threshold_model(), decoded(gray), None)
    assert a.min_detectable_px == pytest.approx(2 * math.sqrt(0.0005 * 256 * 256 / math.pi))
    b = m.analyze(threshold_model(), decoded(gray), None)
    assert a.particles == b.particles and np.array_equal(a.analysis_gray, b.analysis_gray)


def test_segment_returns_probability_and_labels():
    gray = discs_image(256, 256, [(60, 60, 25), (180, 180, 30)])
    prob, labels = m.segment(threshold_model(), gray)
    assert prob.shape == labels.shape == (256, 256) and prob.dtype == np.float32
    assert labels.max() == 2 and set(np.unique(prob)) <= {0.0, 1.0}


# ------------------------------------------------------------------ size classes

def test_size_distribution_bins():
    bins = m.size_distribution([5, 10, 15, 60, 6000])
    assert [b.count for b in bins] == [1, 2, 0, 1, 0, 0, 0, 0, 1]
    assert bins[0].lower == 0 and bins[0].upper == 10 and bins[-1].upper == math.inf
    assert [b.lower for b in bins] == [0, 10, 20, 50, 100, 200, 500, 1000, 5000]
    assert [b.count for b in m.size_distribution([])] == [0] * 9


# ------------------------------------------------------------------ corrections

def _particles():
    shapes = ["fibre", "fibre", "fragment", "bille", "fragment"]
    return [{"id": i + 1, "shape": s, "feret_max_px": 10.0 * (i + 1)} for i, s in enumerate(shapes)]


def test_apply_corrections():
    v = m.apply_corrections(_particles(), None, [2], [(3, "film"), (4, "bille")], 2)
    assert (v.count, v.kept, v.excluded, v.missed) == (6, 4, 1, 2)
    assert dict(v.by_shape) == {"fibre": 1, "fragment": 1, "bille": 1, "film": 1,
                                "unspecified": 2}
    assert v.changes == 1 and v.size_bins is None
    with_scale = m.apply_corrections(_particles(), 2.0, [2], [], 0)
    assert with_scale.size_bins is not None and sum(b.count for b in with_scale.size_bins) == 4
    assert with_scale.changes == 0 and dict(with_scale.by_shape)["unspecified"] == 0
    untouched = m.apply_corrections(_particles(), None, [], [], 0)
    assert (untouched.count, untouched.kept, untouched.excluded, untouched.changes) == (5, 5, 0, 0)


@pytest.mark.parametrize("excluded,reshaped,code,pid", [
    ([9], [], "unknown_particle", 9),
    ([], [(9, "fibre")], "unknown_particle", 9),
    ([2], [(2, "bille")], "both", 2),
    ([], [(2, "cercle")], "unknown_shape", 2),
])
def test_apply_corrections_errors(excluded, reshaped, code, pid):
    with pytest.raises(m.CorrectionError) as exc:
        m.apply_corrections(_particles(), None, excluded, reshaped, 0)
    assert (exc.value.code, exc.value.particle_id) == (code, pid)


def test_apply_corrections_rejects_bad_missed_count():
    with pytest.raises(ValueError):
        m.apply_corrections(_particles(), None, [], [], -1)


# ------------------------------------------------------------------ archive

def test_model_arrays_round_trip_and_validation():
    model = threshold_model(pixel_threshold=0.7, min_area_frac=0.005, shape_min_score=0.7,
                            max_foreground=0.25)
    model = dataclasses.replace(model, meta={"metrics": {"f1": 0.5}})
    arrays = m.model_to_arrays(model)
    for key in ("forest/feature", "forest/threshold", "forest/left", "forest/right",
                "forest/value", "forest/roots", "shape/mean", "shape/scale", "shape/coef",
                "shape/intercept", "shape/classes", "meta"):
        assert key in arrays
    assert arrays["forest/feature"].dtype == np.int16
    assert arrays["forest/threshold"].dtype == np.float32
    assert arrays["shape/coef"].dtype == np.float64
    back = m.model_from_arrays(arrays)
    assert back.name == model.name and back.version == model.version
    assert back.settings == model.settings and dict(back.meta) == dict(model.meta)
    assert back.shape.classes == model.shape.classes
    assert np.array_equal(back.forest.feature, model.forest.feature)
    assert back.forest.max_depth == model.forest.max_depth

    for broken in ("forest/roots", "shape/coef", "meta"):
        bad = dict(arrays)
        del bad[broken]
        with pytest.raises(ValueError, match="invalid model archive"):
            m.model_from_arrays(bad)
    bad = dict(arrays)
    bad["forest/left"] = np.array([1, 1, 99], dtype=np.int32)
    with pytest.raises(ValueError, match="invalid model archive"):
        m.model_from_arrays(bad)
    bad = dict(arrays)
    bad["shape/coef"] = np.zeros((2, 6))
    with pytest.raises(ValueError, match="invalid model archive"):
        m.model_from_arrays(bad)


def test_load_model_bytes_reads_verified_archive():
    from microtrace_core.archive import archive_bytes

    model = threshold_model()
    back = m.load_model_bytes(archive_bytes(m.model_to_arrays(model)))
    assert back.settings == model.settings
    with pytest.raises(ValueError, match="invalid model archive"):
        m.load_model_bytes(b"not an archive")


def test_analysis_is_stable_for_png_bytes():
    gray = discs_image(300, 300, [(150, 150, 60)])
    d = decode_image(png(gray))
    assert m.analyze(threshold_model(), d, None).count == 1
    assert Image.open  # Pillow is imported for decode only


def test_entered_scale_must_be_a_positive_number():
    d = decoded(np.zeros((200, 300), np.uint8))
    for bad in (float("nan"), float("inf"), 0.0, -1.0):
        with pytest.raises(ValueError):
            m.resolve_scale(d, bad, 300)


def test_duplicate_reshaped_ids_are_refused():
    with pytest.raises(m.CorrectionError) as exc:
        m.apply_corrections(_particles(), None, [], [(2, "fibre"), (2, "bille")], 0)
    assert (exc.value.code, exc.value.particle_id) == ("duplicate", 2)
