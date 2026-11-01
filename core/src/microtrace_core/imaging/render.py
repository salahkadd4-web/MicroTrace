"""PNG writers: pixels only. No ``pnginfo``, no EXIF, no text chunk."""
from __future__ import annotations

import io
from collections.abc import Sequence
from typing import TYPE_CHECKING

import numpy as np
from PIL import Image, ImageDraw

if TYPE_CHECKING:
    from microtrace_core.imaging.model import ScoredParticle

SHAPE_COLOURS = {
    "fibre": (0, 114, 178),
    "fragment": (230, 159, 0),
    "bille": (204, 121, 167),
    "film": (0, 158, 115),
}
_FALLBACK = (255, 255, 255)


def _encode(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=False)  # no pnginfo, no exif
    return buf.getvalue()


def png_bytes(gray: np.ndarray) -> bytes:
    """An 8-bit gray PNG of ``gray`` without any metadata."""
    return _encode(Image.fromarray(np.ascontiguousarray(gray, dtype=np.uint8)))


def annotated_png(gray: np.ndarray, particles: Sequence[ScoredParticle]) -> bytes:
    """RGB PNG with each particle's contour in its shape colour and its number."""
    rgb = Image.fromarray(np.ascontiguousarray(gray, dtype=np.uint8)).convert("RGB")
    draw = ImageDraw.Draw(rgb)
    width = max(1, round(max(rgb.size) / 500))
    for sp in particles:
        colour = SHAPE_COLOURS.get(sp.shape, _FALLBACK)
        pts = [(float(x), float(y)) for x, y in sp.particle.contour]
        if len(pts) >= 2:
            draw.line(pts, fill=colour, width=width, joint="curve")
        x0, y0, _x1, _y1 = sp.particle.bbox
        label = str(sp.particle.id) + ("" if sp.confident else "?")
        tx, ty = x0 + 2, max(0, y0 - 11)
        draw.text((tx + 1, ty + 1), label, fill=(0, 0, 0))
        draw.text((tx, ty), label, fill=colour)
    return _encode(rgb)
