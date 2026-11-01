"""Safe decoding of PNG / JPEG / TIFF microscope images.

Nothing read from the file except pixels and one number (the Hitachi ``PixelSize``) leaves this
module: no comment, author, path, EXIF or XMP string is returned, logged or kept.
"""
from __future__ import annotations

import io
import logging
import math
import re
import struct
import warnings
from dataclasses import dataclass
from enum import StrEnum

import numpy as np
from PIL import Image

MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_PIXELS = 40_000_000
MIN_SIDE = 128
HITACHI_BAR_FRACTION = 1 / 16

Image.MAX_IMAGE_PIXELS = MAX_PIXELS
# Pillow logs the raw value of every TIFF tag at DEBUG (operator names, comments): never
logging.getLogger("PIL").setLevel(logging.WARNING)

_XP_COMMENT = 40092
_ORIENTATION = 0x0112
_FORMATS = ("PNG", "JPEG", "TIFF")
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_PIXEL_SIZE = re.compile(r"^PixelSize=([0-9.]+)$", re.MULTILINE)
_SERIAL = re.compile(r"^SerialNumber=", re.MULTILINE)
_DATA_NUMBER = re.compile(r"^DataNumber=", re.MULTILINE)
_STRETCH = (0.5, 99.5)


class ImageIssue(StrEnum):
    EMPTY = "empty"
    UNSUPPORTED_FORMAT = "unsupported_format"
    UNREADABLE = "unreadable"
    MULTIPAGE = "multipage"
    TOO_SMALL = "too_small"
    TOO_MANY_PIXELS = "too_many_pixels"
    UNSUPPORTED_MODE = "unsupported_mode"


class ImageReadError(ValueError):
    """A refused image. Carries a code and numbers only, never any content of the file."""

    def __init__(self, issue: ImageIssue, width: int | None = None, height: int | None = None,
                 pixels: int | None = None) -> None:
        super().__init__(issue.value)
        self.issue = issue
        self.width = width
        self.height = height
        self.pixels = pixels


@dataclass(frozen=True)
class DecodedImage:
    gray: np.ndarray  # uint8 (h, w), oriented, information bar removed
    format: str
    width: int
    height: int
    bit_depth: int
    color: str
    orientation_applied: bool
    alpha_ignored: bool
    cropped_bottom_px: int
    metadata_um_per_px: float | None
    contrast: float  # percentile 99 - percentile 1, out of 255

    def __repr__(self) -> str:  # never print pixels
        return (f"DecodedImage({self.format} {self.width}x{self.height} {self.color} "
                f"{self.bit_depth}-bit)")


def hitachi_pixel_size_nm(xp_comment: bytes | str) -> float | None:
    """The pixel size in nm from an acquisition comment: the ``PixelSize=<number>`` line only."""
    text = _comment_text(xp_comment)
    m = _PIXEL_SIZE.search(text)
    if m is None:
        return None
    try:
        value = float(m.group(1))
    except ValueError:
        return None
    return value if math.isfinite(value) and 0 < value < 1e9 else None


def _comment_text(raw: bytes | str | tuple) -> str:
    """Text of an acquisition comment: UTF-16-LE (TIFF XPComment) or plain 8-bit."""
    if isinstance(raw, str):
        text = raw
    else:
        if isinstance(raw, tuple):
            raw = bytes(int(b) & 0xFF for b in raw)
        raw = bytes(raw)
        if len(raw) >= 2 and len(raw) % 2 == 0 and raw[1] == 0:
            text = raw.decode("utf-16-le", errors="ignore")
        else:
            text = raw.decode("utf-8", errors="ignore")
    return text.replace(chr(0), '').replace(chr(13) + chr(10), chr(10)).replace(chr(13), chr(10))


def hitachi_um_per_px(xp_comment: bytes | str | tuple) -> float | None:
    """um per pixel of a Hitachi acquisition comment: needs ``SerialNumber=`` and
    ``DataNumber=`` lines next to the ``PixelSize=`` one, else None."""
    text = _comment_text(xp_comment)
    if not (_SERIAL.search(text) and _DATA_NUMBER.search(text)):
        return None
    nm = hitachi_pixel_size_nm(text)
    return None if nm is None else nm / 1000.0


def _png_declared_size(data: bytes) -> tuple[int, int] | None:
    if data[:8] == _PNG_MAGIC and data[12:16] == b"IHDR" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    return None


def _check_size(width: int, height: int) -> None:
    pixels = width * height
    if pixels > MAX_PIXELS:
        raise ImageReadError(ImageIssue.TOO_MANY_PIXELS, width, height, pixels)
    if min(width, height) < MIN_SIDE:
        raise ImageReadError(ImageIssue.TOO_SMALL, width, height, pixels)


def _stretch(values: np.ndarray) -> np.ndarray:
    a = np.nan_to_num(np.asarray(values, dtype=np.float64), nan=0.0, posinf=0.0, neginf=0.0)
    lo, hi = np.percentile(a, _STRETCH)
    if hi <= lo:
        return np.zeros(a.shape, dtype=np.uint8)
    return np.rint(np.clip((a - lo) / (hi - lo), 0.0, 1.0) * 255.0).astype(np.uint8)


def _orient(a: np.ndarray, orientation: int) -> np.ndarray:
    if orientation == 2:
        return a[:, ::-1]
    if orientation == 3:
        return a[::-1, ::-1]
    if orientation == 4:
        return a[::-1, :]
    if orientation == 5:
        return a.T
    if orientation == 6:
        return np.rot90(a, -1)
    if orientation == 7:
        return a[::-1, ::-1].T
    if orientation == 8:
        return np.rot90(a, 1)
    return a


_INVERSE_ORIENTATION = {6: 8, 8: 6}


def _to_gray(img: Image.Image) -> tuple[np.ndarray, int, str, bool]:
    """(uint8 gray, bit depth, colour kind, alpha ignored) from a loaded image."""
    mode = img.mode
    if mode == "1":
        return np.asarray(img.convert("L")), 1, "gray", False
    if mode == "L":
        return np.asarray(img), 8, "gray", False
    if mode == "P":
        return np.asarray(img.convert("L")), 8, "palette", False
    if mode == "LA":
        return np.asarray(img.convert("L")), 8, "gray", True
    if mode == "PA":
        return np.asarray(img.convert("RGBA").convert("L")), 8, "palette", True
    if mode in ("RGB", "RGBA", "RGBX"):
        return np.asarray(img.convert("L")), 8, "rgb", mode == "RGBA"
    if mode == "CMYK":
        return np.asarray(img.convert("RGB").convert("L")), 8, "cmyk", False
    if mode.startswith("I;16"):
        return _stretch(np.asarray(img)), 16, "gray", False
    if mode == "I":
        return _stretch(np.asarray(img)), 32, "gray", False
    if mode == "F":
        return _stretch(np.asarray(img)), 32, "gray", False
    raise ImageReadError(ImageIssue.UNSUPPORTED_MODE, img.width, img.height)


def decode_image(data: bytes) -> DecodedImage:
    """Decode to an oriented 8-bit gray array. Raises ``ImageReadError`` (code and numbers only)."""
    if not data:
        raise ImageReadError(ImageIssue.EMPTY)
    declared = _png_declared_size(data)
    if declared is not None:
        _check_size(*declared)  # before Pillow touches the stream
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            img = Image.open(io.BytesIO(data), formats=list(_FORMATS))
    except Image.DecompressionBombError:
        raise ImageReadError(ImageIssue.TOO_MANY_PIXELS) from None
    except Exception:  # noqa: BLE001 - not a PNG, JPEG or TIFF we can open
        raise ImageReadError(ImageIssue.UNSUPPORTED_FORMAT) from None

    try:
        fmt = img.format or ""
        width, height = img.size
        _check_size(width, height)
        if getattr(img, "n_frames", 1) > 1:
            raise ImageReadError(ImageIssue.MULTIPAGE, width, height, width * height)

        orientation = 1
        bar_text = ""
        try:
            orientation = int(img.getexif().get(_ORIENTATION, 1) or 1)
            if fmt == "TIFF":
                raw = img.tag_v2.get(_XP_COMMENT)
                if raw is not None:
                    bar_text = _comment_text(raw)
        except Exception:  # noqa: BLE001 - unreadable metadata is simply ignored
            orientation, bar_text = 1, ""

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                img.load()
        except ImageReadError:
            raise
        except Exception:  # noqa: BLE001 - truncated or corrupt pixel data
            raise ImageReadError(ImageIssue.UNREADABLE, width, height, width * height) from None

        gray, bit_depth, color, alpha_ignored = _to_gray(img)
        # Pillow already applies the orientation of a TIFF while loading it; bring that back to
        # the stored layout so every format is oriented once, here, after the bar is cut.
        if fmt == "TIFF" and orientation in range(2, 9):
            gray = _orient(gray, _INVERSE_ORIENTATION.get(orientation, orientation))
    finally:
        img.close()

    cropped = 0
    um_per_px = hitachi_um_per_px(bar_text)
    if um_per_px is not None:
        cropped = math.ceil(gray.shape[0] * HITACHI_BAR_FRACTION)
        gray = gray[: gray.shape[0] - cropped]
        _check_size(gray.shape[1], gray.shape[0])  # the cropped image must still be big enough
    del bar_text

    applied = orientation in range(2, 9)
    if applied:
        gray = _orient(gray, orientation)
    gray = np.ascontiguousarray(gray, dtype=np.uint8)
    if min(gray.shape) < 1:
        raise ImageReadError(ImageIssue.UNREADABLE, width, height, width * height)
    p1, p99 = np.percentile(gray, [1, 99])
    return DecodedImage(
        gray=gray, format=fmt, width=int(gray.shape[1]), height=int(gray.shape[0]),
        bit_depth=bit_depth, color=color, orientation_applied=applied,
        alpha_ignored=alpha_ignored, cropped_bottom_px=cropped, metadata_um_per_px=um_per_px,
        contrast=float(p99 - p1))
