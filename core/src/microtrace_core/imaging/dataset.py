"""Index of ``dataset3`` (training side only): masks, counts, scales, groups, fixed split.

Acquisition sidecar files (``*.txt`` next to the TIFFs) are never opened: they hold the
operators' names. Only the ``counts_*.txt`` files are read.
"""
from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
from PIL import Image

from microtrace_core.imaging.reading import decode_image, hitachi_um_per_px

# subset -> (folder with image/ and label/, folder with the original TIFFs, shape)
SUBSETS: Mapping[str, tuple[str, str | None, str]] = {
    "bead": ("bead/bead", "bead/original_image_bead", "bille"),
    "fibre_1": ("fibre/fibre_1", "fibre/original_image_fibre_1", "fibre"),
    "fibre_2": ("fibre/fibre_2", "fibre/original_image_fibre_2", "fibre"),
    "fragment_1": ("fragment/fragment_1", "fragment/original_image_fragment", "fragment"),
    "fragment_2": ("fragment/fragment_2", "fragment/original_image_fragment", "fragment"),
}
THUMB_SIZE = (64, 48)  # width, height
_XP_COMMENT = 40092
_COUNT_LINE = re.compile(r"^(.+?)\s+(\d+)\s*$")
_SAMPLE_PREFIX = re.compile(r"^([A-Za-z]+_\d+)")


@dataclass(frozen=True)
class Item:
    subset: str
    shape: str
    image: Path
    label: Path
    count: int | None
    um_per_px: float | None  # um per pixel of the PNG
    tiff: Path | None
    group: str
    split: str


def read_counts(path: Path) -> dict[str, int]:
    """``{image name: count}`` from a ``counts_*.txt`` file (tabs and trailing blanks tolerated)."""
    out: dict[str, int] = {}
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        m = _COUNT_LINE.match(line)
        if m:
            out[m.group(1).strip()] = int(m.group(2))
    return out


def _tiff_key(stem: str) -> tuple[str, int] | None:
    """Name of a PNG or TIFF reduced to (family, shot number)."""
    m = re.match(r"^(.*?)(\d+)$", stem.lower())
    if m is None:
        return None
    family = re.sub(r"(?:^|_)(no|new|fibres)(?=_|$)", "", m.group(1)).strip("_")
    family = re.sub(r"_?no$", "", family).strip("_")
    return family, int(m.group(2))


def _um_per_px(tiff: Path, png_width: int) -> float | None:
    """Hitachi ``PixelSize`` of the TIFF, brought to the PNG's pixel (the PNG is a resized crop)."""
    with Image.open(tiff) as im:
        raw = getattr(im, "tag_v2", {}).get(_XP_COMMENT)
        width = im.width
    if raw is None:
        return None
    um = hitachi_um_per_px(raw)
    return None if um is None else um * width / png_width


def _path_key(item: Item) -> str:
    """Root-independent key of a photo: ``<subset folder>/image/<file name>``."""
    return f"{SUBSETS[item.subset][0]}/image/{item.image.name}"


def _sample_prefix(item: Item) -> str | None:
    """fibre_2 only: the sample prefix (``PAN_01``, ``PE_03``...), the same field at several
    voltages."""
    if item.subset != "fibre_2":
        return None
    m = _SAMPLE_PREFIX.match(item.image.stem)
    return m.group(1) if m else None


def thumbnail(path: Path) -> np.ndarray:
    """64 x 48 gray thumbnail (float32, shape (48, 64)) used to find near-duplicate photos."""
    with Image.open(path) as im:
        small = im.convert("L").resize(THUMB_SIZE, Image.Resampling.BILINEAR)
    return np.asarray(small, dtype=np.float32)


def split_of(group_key: str) -> str:
    """Fixed split: sha256(group key) mod 100 -- below 20 test, below 40 validation, else train."""
    n = int.from_bytes(hashlib.sha256(group_key.encode("utf-8")).digest(), "big") % 100
    return "test" if n < 20 else "val" if n < 40 else "train"


def assign_groups(items: Sequence[Item], thumbs: np.ndarray, threshold: float = 0.9
                  ) -> list[str]:
    """Group key of each item: same sample prefix (fibre_2) or correlated thumbnails (> threshold)
    share a group. The key of a group is the smallest path key among its photos."""
    keys = [_path_key(it) for it in items]
    parent = {k: k for k in keys}
    first_of: dict[str, str] = {}
    for it, key in zip(items, keys, strict=True):
        prefix = _sample_prefix(it)
        if prefix is not None:
            first_of.setdefault(prefix, key)

    def find(k: str) -> str:
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    for it, key in zip(items, keys, strict=True):
        prefix = _sample_prefix(it)
        if prefix is not None:
            union(first_of[prefix], key)

    flat = np.asarray(thumbs, dtype=np.float64).reshape(len(items), -1)
    z = flat - flat.mean(axis=1, keepdims=True)
    norm = np.linalg.norm(z, axis=1, keepdims=True)
    z = np.divide(z, norm, out=np.zeros_like(z), where=norm > 0)
    corr = z @ z.T
    ii, jj = np.nonzero(np.triu(corr > threshold, k=1))
    for i, j in zip(ii, jj, strict=True):
        union(keys[i], keys[j])
    return [find(k) for k in keys]


def build_index(root: Path) -> list[Item]:
    """Every original photo of the five subsets with its mask, count, scale, group and side.

    Derived folders (``*crop``, ``label_index``) are not subsets and are never listed.
    """
    root = Path(root)
    items: list[Item] = []
    for subset, (folder, tiff_folder, shape) in SUBSETS.items():
        base = root / folder
        if not (base / "image").is_dir():
            continue
        counts: dict[str, int] = {}
        for counts_file in sorted(base.glob("counts_*.txt")):
            counts.update(read_counts(counts_file))
        tiffs: dict[tuple[str, int], list[Path]] = {}
        if tiff_folder is not None and (root / tiff_folder).is_dir():
            for t in sorted((root / tiff_folder).glob("*.tif")):
                key = _tiff_key(t.stem)
                if key is not None:
                    tiffs.setdefault(key, []).append(t)
        for png in sorted((base / "image").glob("*.png")):
            label = base / "label" / png.name
            if not label.is_file():
                continue
            found = tiffs.get(_tiff_key(png.stem) or ("", -1), [])
            tiff = found[0] if len(found) == 1 else None
            scale = None
            if tiff is not None:
                with Image.open(png) as im:
                    scale = _um_per_px(tiff, im.width)
            items.append(Item(subset, shape, png, label, counts.get(png.name), scale, tiff,
                              "", ""))
    items.sort(key=lambda i: i.image.as_posix())
    if not items:
        return []
    groups = assign_groups(items, np.stack([thumbnail(i.image) for i in items]))
    return [replace(i, group=g, split=split_of(g)) for i, g in zip(items, groups, strict=True)]


# ------------------------------------------------------------------ pixels of an item

def load_gray(path: Path) -> np.ndarray:
    """The photo through the production decoder (same gray image as at serving time)."""
    return decode_image(Path(path).read_bytes()).gray


def load_mask(path: Path, shape: tuple[int, int] | None = None) -> np.ndarray:
    """Boolean mask (threshold 128 on the luminance), resized to ``shape`` if different."""
    with Image.open(path) as im:
        lum = im.convert("L")
        if shape is not None and (lum.height, lum.width) != tuple(shape):
            lum = lum.resize((shape[1], shape[0]), Image.Resampling.BILINEAR)
        return np.asarray(lum) >= 128
