"""Safe image reading: formats, orientation, errors, Hitachi scale, no metadata leaks."""
from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image, ImageFile

from microtrace_core.imaging import reading
from microtrace_core.imaging.reading import (
    ImageIssue,
    ImageReadError,
    decode_image,
    hitachi_pixel_size_nm,
)
from microtrace_core.imaging.render import annotated_png, png_bytes

from imaging_fixtures import (
    SERIAL_COMMENT,
    forged_png_header,
    jpeg,
    png,
    png_chunks,
    ramp16,
    tiff,
    to_u8,
    trapped_tiff,
)

H, W = 150, 200


def _gray() -> np.ndarray:
    return to_u8(np.tile(np.linspace(0, 255, W), (H, 1)))


def _rgb() -> Image.Image:
    g = _gray()
    return Image.fromarray(np.dstack([g, g[::-1], g[:, ::-1]]), "RGB")


FORMATS = {
    "png_l": (lambda: png(_gray()), "PNG", "gray", 8),
    "png_rgba": (lambda: png(Image.fromarray(
        np.dstack([_gray()] * 3 + [np.full((H, W), 90, np.uint8)]), "RGBA")), "PNG", "rgb", 8),
    "png_palette": (lambda: png(Image.fromarray(_gray()).convert("P")), "PNG", "palette", 8),
    "jpeg_rgb": (lambda: jpeg(_rgb()), "JPEG", "rgb", 8),
    "jpeg_cmyk": (lambda: jpeg(_rgb().convert("CMYK")), "JPEG", "cmyk", 8),
    "tiff_16": (lambda: tiff(ramp16()), "TIFF", "gray", 16),
    "tiff_float": (lambda: tiff(ramp16().astype(np.float32)), "TIFF", "gray", 32),
}


@pytest.mark.parametrize("name", sorted(FORMATS))
def test_decode_formats(name):
    make, fmt, color, depth = FORMATS[name]
    d = decode_image(make())
    assert d.gray.dtype == np.uint8 and d.gray.shape == (H, W)
    assert (d.format, d.color, d.bit_depth) == (fmt, color, depth)
    assert (d.width, d.height) == (W, H)
    assert d.alpha_ignored is (name == "png_rgba")
    assert d.orientation_applied is False and d.cropped_bottom_px == 0
    assert d.metadata_um_per_px is None
    if name in ("tiff_16", "tiff_float"):
        assert d.gray.min() == 0 and d.gray.max() == 255
    assert 0 <= d.contrast <= 255


def test_decode_luminance_of_rgb():
    d = decode_image(png(Image.new("RGB", (W, H), (255, 0, 0))))
    assert int(d.gray[0, 0]) == Image.new("RGB", (1, 1), (255, 0, 0)).convert("L").getpixel((0, 0))


def test_decode_exif_orientation_6():
    # the brief's example is 200 x 100 but its shorter side (100) is below MIN_SIDE: 256 x 140
    arr = to_u8(np.tile(np.linspace(0, 255, 256), (140, 1)))
    exif = Image.Exif()
    exif[0x0112] = 6
    d = decode_image(jpeg(Image.fromarray(arr), exif=exif))
    assert (d.width, d.height) == (140, 256) and d.orientation_applied
    assert d.gray.shape == (256, 140)


_METHODS = {2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180,
            4: Image.Transpose.FLIP_TOP_BOTTOM, 5: Image.Transpose.TRANSPOSE,
            6: Image.Transpose.ROTATE_270, 7: Image.Transpose.TRANSVERSE,
            8: Image.Transpose.ROTATE_90}


def _oriented_file(fmt: str, arr: np.ndarray, orientation: int) -> bytes:
    if fmt == "PNG":
        exif = Image.Exif()
        exif[0x0112] = orientation
        return png(arr, exif=exif)
    if fmt == "JPEG":
        exif = Image.Exif()
        exif[0x0112] = orientation
        return jpeg(Image.fromarray(arr), exif=exif, quality=95)
    return tiff(arr, orientation=orientation)


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "TIFF"])
@pytest.mark.parametrize("orientation", range(1, 9))
def test_decode_every_orientation_once(fmt, orientation):
    rng = np.random.default_rng(0)
    arr = rng.integers(0, 255, (130, 190), dtype=np.uint8)
    if fmt == "JPEG":  # lossy: smooth, asymmetric content
        yy, xx = np.mgrid[0:130, 0:190]
        arr = to_u8(xx * 1.2 + yy * 0.3 + 40 * (xx > 120))
    d = decode_image(_oriented_file(fmt, arr, orientation))
    expected = arr if orientation == 1 else np.asarray(
        Image.fromarray(arr).transpose(_METHODS[orientation]))
    assert d.gray.shape == expected.shape and (d.height, d.width) == expected.shape
    if fmt == "JPEG":
        assert np.abs(d.gray.astype(int) - expected.astype(int)).mean() < 6
    else:
        assert np.array_equal(d.gray, expected)
    assert d.orientation_applied is (orientation != 1)


def test_hitachi_bar_is_cut_in_the_stored_layout_whatever_the_orientation():
    for orientation in range(1, 9):
        stored = np.full((400, 320), 100, np.uint8)
        stored[375:] = 255  # the information bar: ceil(400 / 16) = 25 stored bottom rows
        stored[:, :10] = 30  # content marker on the stored left edge
        d = decode_image(tiff(stored, comment=SERIAL_COMMENT, orientation=orientation))
        assert d.cropped_bottom_px == 25 and d.metadata_um_per_px == 0.9921875
        assert not (d.gray == 255).any(), orientation
        assert d.gray.size == 375 * 320 and (d.height, d.width) == d.gray.shape
        assert d.gray.shape == ((375, 320) if orientation in (1, 2, 3, 4) else (320, 375))
        assert int((d.gray == 30).sum()) == 10 * 375  # no content row lost


def test_cropped_image_must_still_be_large_enough():
    stored = to_u8(np.tile(np.linspace(0, 255, 256), (136, 1)))  # 136 rows, 9 are the bar
    with pytest.raises(ImageReadError) as exc:
        decode_image(tiff(stored, comment=SERIAL_COMMENT))
    assert exc.value.issue is ImageIssue.TOO_SMALL


def _truncated() -> bytes:
    noisy = np.random.default_rng(0).integers(0, 255, (H, W), dtype=np.uint8)
    data = png(noisy)
    return data[: len(data) // 2]


def _two_pages() -> bytes:
    buf = io.BytesIO()
    Image.fromarray(_gray()).save(
        buf, "TIFF", save_all=True, append_images=[Image.fromarray(_gray()[::-1].copy())])
    return buf.getvalue()


def _gif() -> bytes:
    buf = io.BytesIO()
    Image.fromarray(_gray()).save(buf, "GIF")
    return buf.getvalue()


ERRORS = {
    "empty": (lambda: b"", ImageIssue.EMPTY),
    "gif": (_gif, ImageIssue.UNSUPPORTED_FORMAT),
    "garbage": (lambda: b"not an image at all", ImageIssue.UNSUPPORTED_FORMAT),
    "truncated": (_truncated, ImageIssue.UNREADABLE),
    "two_pages": (_two_pages, ImageIssue.MULTIPAGE),
    "too_small": (lambda: png(np.zeros((300, 100), np.uint8)), ImageIssue.TOO_SMALL),
    "lab_mode": (lambda: tiff(Image.new("LAB", (W, H))), ImageIssue.UNSUPPORTED_MODE),
}


@pytest.mark.parametrize("name", sorted(ERRORS))
def test_decode_errors(name):
    make, issue = ERRORS[name]
    with pytest.raises(ImageReadError) as exc:
        decode_image(make())
    assert exc.value.issue is issue


def test_too_small_error_carries_numbers_only():
    with pytest.raises(ImageReadError) as exc:
        decode_image(png(np.zeros((300, 100), np.uint8)))
    e = exc.value
    assert (e.width, e.height) == (100, 300)
    assert str(e) == "too_small"


def test_huge_header_is_refused_before_any_decoding(monkeypatch):
    calls = []
    original = ImageFile.ImageFile.load

    def spy(self, *a, **k):
        calls.append(1)
        return original(self, *a, **k)

    monkeypatch.setattr(Image.Image, "load", spy)
    monkeypatch.setattr(ImageFile.ImageFile, "load", spy)
    data = forged_png_header(50_000, 50_000)
    assert len(data) < 250
    with pytest.raises(ImageReadError) as exc:
        decode_image(data)
    assert exc.value.issue is ImageIssue.TOO_MANY_PIXELS
    assert exc.value.pixels == 50_000 * 50_000
    assert calls == []


def test_reading_limits():
    assert reading.MAX_PIXELS == 40_000_000 and reading.MIN_SIDE == 128
    assert reading.MAX_IMAGE_BYTES == 25 * 1024 * 1024
    assert reading.HITACHI_BAR_FRACTION == 1 / 16


def test_hitachi_scale_and_bar():
    arr = to_u8(np.tile(np.linspace(0, 255, 1280), (960, 1)))
    d = decode_image(tiff(arr, comment=SERIAL_COMMENT))
    assert d.metadata_um_per_px == 0.9921875
    assert d.cropped_bottom_px == 60 and d.gray.shape == (900, 1280)
    assert np.array_equal(d.gray, arr[:900])
    assert (d.width, d.height) == (1280, 900)

    no_serial = SERIAL_COMMENT.replace("SerialNumber=5000-3123-03\r\n", "")
    d2 = decode_image(tiff(arr, comment=no_serial))
    assert d2.metadata_um_per_px is None and d2.cropped_bottom_px == 0
    assert d2.gray.shape == (960, 1280)

    d3 = decode_image(tiff(arr, dpi=(25400, 25400)))  # 25 400 px/inch is 1 um/px: never used
    assert d3.metadata_um_per_px is None and d3.cropped_bottom_px == 0


def test_hitachi_pixel_size_pattern_only():
    assert hitachi_pixel_size_nm("A=1\r\nPixelSize=763.2211\r\nB=2") == 763.2211
    assert hitachi_pixel_size_nm("PixelSize=12.5\n".encode("utf-16-le") + b"\x00\x00") == 12.5
    assert hitachi_pixel_size_nm(b"PixelSize=12.5\n") == 12.5
    for bad in ("PixelSize=12.5nm", "xPixelSize=3", "pixelsize=3", "PixelSize=", "PixelSize=1.2.3",
                "PixelSize=0", "Comment=PixelSize=4", ""):
        assert hitachi_pixel_size_nm(bad) is None, bad


def test_no_metadata_string_leaks():
    data = trapped_tiff()
    assert b"Dupont" in data or "Dupont".encode("utf-16-le") in data  # the trap is really there
    d = decode_image(data)
    assert d.metadata_um_per_px is not None
    assert "Dupont" not in repr(d)
    for blob in (png_bytes(d.gray), annotated_png(d.gray, [])):
        assert b"Dupont" not in blob and "Dupont".encode("utf-16-le") not in blob
        chunks = png_chunks(blob)
        assert not {"tEXt", "iTXt", "zTXt", "eXIf"} & set(chunks)
        assert chunks[0] == "IHDR" and chunks[-1] == "IEND"
