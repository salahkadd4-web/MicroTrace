"""PNG writers: pixels only, deterministic, annotated overlay."""
from __future__ import annotations

import io

import numpy as np
from PIL import Image

from microtrace_core.imaging.model import analyze
from microtrace_core.imaging.render import annotated_png, png_bytes

from imaging_fixtures import decoded, discs_image, png_chunks, threshold_model


def test_png_bytes_round_trip_and_determinism():
    a = np.random.default_rng(0).integers(0, 255, (140, 190), dtype=np.uint8)
    data = png_bytes(a)
    assert data == png_bytes(a)
    img = Image.open(io.BytesIO(data))
    assert img.format == "PNG" and img.mode == "L" and img.info == {}
    assert np.array_equal(np.asarray(img), a)
    assert set(png_chunks(data)) <= {"IHDR", "IDAT", "IEND"}


def test_annotated_png_draws_contours_and_numbers():
    gray = discs_image(256, 256, [(70, 70, 30), (180, 180, 40)], bg=20, fg=200)
    result = analyze(threshold_model(), decoded(gray), None)
    assert result.count == 2
    ann = annotated_png(result.analysis_gray, result.particles)
    img = Image.open(io.BytesIO(ann))
    assert img.mode == "RGB" and img.size == (256, 256) and img.info == {}
    arr = np.asarray(img).astype(int)
    colourful = (np.abs(arr[..., 0] - arr[..., 1]) > 40) | (np.abs(arr[..., 1] - arr[..., 2]) > 40)
    assert colourful.sum() > 200
    assert set(png_chunks(ann)).isdisjoint({"tEXt", "iTXt", "zTXt", "eXIf"})
    plain = np.asarray(Image.open(io.BytesIO(png_bytes(result.analysis_gray))))
    assert not np.array_equal(arr[..., 0], plain)
    assert ann == annotated_png(result.analysis_gray, result.particles)


def test_annotated_png_without_particles_is_the_gray_image_in_rgb():
    gray = np.full((140, 150), 77, np.uint8)
    arr = np.asarray(Image.open(io.BytesIO(annotated_png(gray, []))))
    assert arr.shape == (140, 150, 3) and (arr == 77).all()
