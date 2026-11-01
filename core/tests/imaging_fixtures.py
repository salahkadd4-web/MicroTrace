"""Synthetic images and a miniature ``dataset3`` for the C6 tests (never touches datasets/)."""
from __future__ import annotations

import io
import struct
import zlib
from pathlib import Path

import numpy as np
from PIL import Image, TiffImagePlugin
from skimage.draw import disk, polygon

TRAP_NAME = "Jean Dupont"
SERIAL_COMMENT = "SerialNumber=5000-3123-03\r\nDataNumber=SU5000 0002\r\nPixelSize=992.1875\r\n"
TRAP_COMMENT = (
    "SerialNumber=5000-3123-03\r\nDataNumber=SU5000 0002\r\nSampleName=Jean Dupont\r\n"
    "Comment=Dupont\r\nKeyWord1=Dupont\r\nPixelSize=992.1875\r\n")


# ------------------------------------------------------------------ pixel content

def noise(shape: tuple[int, int], amplitude: float = 4.0, seed: int = 0) -> np.ndarray:
    return np.random.default_rng(seed).normal(0.0, amplitude, shape)


def gradient(h: int, w: int, lo: float = 30.0, hi: float = 70.0) -> np.ndarray:
    return np.tile(np.linspace(lo, hi, w), (h, 1))


def to_u8(a: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(a), 0, 255).astype(np.uint8)


def discs_image(h: int, w: int, discs: list[tuple[float, float, float]], *, bg: float = 0.0,
                fg: float = 255.0) -> np.ndarray:
    """Plain ``bg`` with filled discs ``(row, col, radius)`` at ``fg`` (uint8, no noise)."""
    a = np.full((h, w), bg, dtype=np.float64)
    for r, c, rad in discs:
        rr, cc = disk((r, c), rad, shape=(h, w))
        a[rr, cc] = fg
    return to_u8(a)


def rect_image(h: int, w: int, top: int, left: int, height: int, width: int,
               *, bg: int = 0, fg: int = 255) -> np.ndarray:
    a = np.full((h, w), bg, dtype=np.uint8)
    a[top:top + height, left:left + width] = fg
    return a


def ramp16(h: int = 150, w: int = 200) -> np.ndarray:
    """uint16 values from 1 000 to 60 000."""
    return np.linspace(1000, 60000, h * w).reshape(h, w).astype(np.uint16)


# ------------------------------------------------------------------ encoders

def png(arr_or_img, **kw) -> bytes:
    img = arr_or_img if isinstance(arr_or_img, Image.Image) else Image.fromarray(arr_or_img)
    buf = io.BytesIO()
    img.save(buf, "PNG", **kw)
    return buf.getvalue()


def jpeg(img: Image.Image, **kw) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", **kw)
    return buf.getvalue()


def tiff(arr_or_img, *, comment: str | None = None, author: str | None = None,
         artist: str | None = None, dpi: tuple[int, int] | None = None, **kw) -> bytes:
    img = arr_or_img if isinstance(arr_or_img, Image.Image) else Image.fromarray(arr_or_img)
    info = TiffImagePlugin.ImageFileDirectory_v2()
    if comment is not None:
        info[40092] = comment.encode("utf-16-le") + b"\x00\x00"
        info.tagtype[40092] = 1
    if author is not None:
        info[40093] = author.encode("utf-16-le") + b"\x00\x00"
        info.tagtype[40093] = 1
    if artist is not None:
        info[315] = artist
    buf = io.BytesIO()
    save_kw = dict(kw)
    if dpi is not None:
        save_kw["dpi"] = dpi
    img.save(buf, "TIFF", tiffinfo=info, **save_kw)
    return buf.getvalue()


def trapped_tiff(h: int = 384, w: int = 512) -> bytes:
    """A Hitachi-like TIFF whose metadata hold a person's name in every place we know of."""
    arr = to_u8(gradient(h, w, 20, 90) + noise((h, w)))
    arr[100:160, 100:180] = 220
    return tiff(arr, comment=TRAP_COMMENT, author=TRAP_NAME, artist=TRAP_NAME)


def png_chunks(data: bytes) -> list[str]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    out, i = [], 8
    while i < len(data):
        (n,) = struct.unpack(">I", data[i:i + 4])
        out.append(data[i + 4:i + 8].decode("ascii"))
        i += 12 + n
    return out


def forged_png_header(width: int, height: int) -> bytes:
    """About 200 bytes: a valid-looking IHDR declaring a huge image, then a little junk IDAT."""
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(
            ">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", b"\x00" * 150)
            + chunk(b"IEND", b""))


# ------------------------------------------------------------------ synthetic model

def threshold_model(*, pixel_threshold: float = 0.5, min_area_frac: float = 0.0005,
                    shape_min_score: float = 0.6, max_foreground: float = 0.4,
                    scale_min: float = 0.06, scale_max: float = 25.0):
    """A one-tree forest that thresholds the normalised intensity at 0.5."""
    from microtrace_core.imaging import IMAGE_MODEL_NAME, IMAGE_MODEL_VERSION
    from microtrace_core.imaging.forest import Forest
    from microtrace_core.imaging.model import ImageModel, Settings
    from microtrace_core.imaging.shape import ShapeModel

    forest = Forest(
        feature=np.array([0, -1, -1], dtype=np.int16),
        threshold=np.array([0.5, 0.0, 0.0], dtype=np.float32),
        left=np.array([1, 1, 2], dtype=np.int32),
        right=np.array([2, 1, 2], dtype=np.int32),
        value=np.array([0.0, 0.0, 1.0], dtype=np.float32),
        roots=np.array([0], dtype=np.int32), max_depth=1)
    coef = np.zeros((3, 6))
    coef[0, 3] = 2.0   # fibre likes a high log-elongation
    coef[2, 0] = 4.0   # bille likes a high circularity
    shape = ShapeModel(mean=np.zeros(6), scale=np.ones(6), coef=coef,
                       intercept=np.array([0.0, 0.5, -2.0]),
                       classes=("fibre", "fragment", "bille"))
    settings = Settings(pixel_threshold, min_area_frac, shape_min_score, max_foreground,
                        scale_min, scale_max)
    return ImageModel(IMAGE_MODEL_NAME, IMAGE_MODEL_VERSION, forest, shape, settings,
                      {"synthetic": True})


def decoded(gray: np.ndarray, **kw):
    """A DecodedImage around ``gray`` for tests that skip the file layer."""
    from microtrace_core.imaging.reading import DecodedImage

    h, w = gray.shape
    p1, p99 = np.percentile(gray, [1, 99])
    base = dict(format="PNG", width=w, height=h, bit_depth=8, color="gray",
                orientation_applied=False, alpha_ignored=False, cropped_bottom_px=0,
                metadata_um_per_px=None, contrast=float(p99 - p1))
    base.update(kw)
    return DecodedImage(gray=gray, **base)


# ------------------------------------------------------------------ miniature dataset3

IMG_W, IMG_H = 256, 192
TIFF_W, TIFF_H = 512, 384
SUBSET_SPECS = {
    # subset: (folder, tiff folder, shape, png name format, tiff name format, counts file)
    "bead": ("bead/bead", "bead/original_image_bead", "bille",
             "Dove_men_acrylates_copolymer_microbeads_{n:03d}.png",
             "Dove_men_acrylates_copolymer_microbeads_new_No{n:04d}.tif", "counts_bead.txt"),
    "fibre_1": ("fibre/fibre_1", "fibre/original_image_fibre_1", "fibre",
                "polyester_{n}.png", "Polyester_Fibres_No{n:04d}.tif", "counts_fibre_1.txt"),
    "fragment_1": ("fragment/fragment_1", "fragment/original_image_fragment", "fragment",
                   "Particle_No{n:04d}.png", "Particle_No{n:04d}.tif", "counts_fragment_1.txt"),
}
# 3 train, 2 validation, 1 test per subset (names are searched, so the split is balanced)
QUOTA = ("train", "train", "train", "val", "val", "test")


def _particle_cells(rng: np.random.Generator, k: int) -> list[tuple[int, int]]:
    cells = [(r, c) for r in range(2) for c in range(3)]
    order = rng.permutation(len(cells))[:k]
    return [cells[i] for i in order]


def synthetic_scene(subset: str, seed: int) -> tuple[np.ndarray, np.ndarray, int]:
    """(image uint8, mask uint8 0/255, number of particles) for one miniature photo."""
    rng = np.random.default_rng(seed)
    mask = np.zeros((IMG_H, IMG_W), dtype=bool)
    cells = _particle_cells(rng, int(rng.integers(1, 3)))
    ch, cw = IMG_H // 2, IMG_W // 3
    for r, c in cells:
        cy, cx = r * ch + ch // 2, c * cw + cw // 2
        if subset == "bead":
            rr, cc = disk((cy, cx), float(rng.integers(16, 24)), shape=mask.shape)
        elif subset == "fibre_1":
            half_l, half_w = int(rng.integers(34, 40)), int(rng.integers(3, 5))
            rr, cc = polygon([cy - half_w, cy - half_w, cy + half_w, cy + half_w],
                             [cx - half_l, cx + half_l, cx + half_l, cx - half_l], mask.shape)
        else:
            ang = np.sort(rng.uniform(0, 2 * np.pi, 7))
            rad = rng.uniform(16, 30, 7)
            rr, cc = polygon(cy + rad * np.sin(ang), cx + rad * np.cos(ang), mask.shape)
        mask[rr, cc] = True
    img = gradient(IMG_H, IMG_W, 30, 60) + noise(mask.shape, 3.0, seed)
    img[mask] = 190 + noise(mask.shape, 3.0, seed + 1)[mask]
    return to_u8(img), (mask * 255).astype(np.uint8), len(cells)


def _pick_names(subset: str, folder: str) -> list[int]:
    """First numbers whose group key falls in each wanted side of the split."""
    from microtrace_core.imaging.dataset import split_of

    spec = SUBSET_SPECS[subset]
    need = list(QUOTA)
    picked: list[int] = []
    n = 1
    while need:
        key = f"{folder}/image/{spec[3].format(n=n)}"
        side = split_of(key)
        if side in need:
            need.remove(side)
            picked.append(n)
        n += 1
        assert n < 5000
    return sorted(picked)


def write_mini_dataset(root: Path, *, drop_last_image: bool = False) -> Path:
    """3 subsets x 6 photos (256 x 192, masks, counts, Hitachi-like TIFF carrying a trap name)."""
    root = Path(root)
    first = True
    for subset, (folder, tiff_folder, _shape, png_fmt, tiff_fmt, counts_name) in \
            SUBSET_SPECS.items():
        numbers = _pick_names(subset, folder)
        (root / folder / "image").mkdir(parents=True, exist_ok=True)
        (root / folder / "label").mkdir(parents=True, exist_ok=True)
        (root / tiff_folder).mkdir(parents=True, exist_ok=True)
        lines = []
        for k, n in enumerate(numbers):
            name = png_fmt.format(n=n)
            if drop_last_image and subset == "fragment_1" and k == len(numbers) - 1:
                continue
            seed = 1000 * list(SUBSET_SPECS).index(subset) + n
            img, mask, count = synthetic_scene(subset, seed)
            (root / folder / "image" / name).write_bytes(png(img))
            (root / folder / "label" / name).write_bytes(png(mask))
            if not (subset == "fragment_1" and k == 0):  # one photo without a count line
                lines.append(f"{name}\t{count}" + ("\t" if k % 2 else " "))
            if not (subset == "fragment_1" and k == 1):  # one photo without a TIFF
                comment = (f"SerialNumber=5000-3123-03\r\nDataNumber=SU5000 {n:04d}\r\n"
                           f"SampleName={TRAP_NAME}\r\nComment=Dupont\r\n"
                           f"PixelSize={500 + 10 * n}\r\n")
                tif = tiff(np.zeros((TIFF_H, TIFF_W), np.uint8), comment=comment,
                           author=TRAP_NAME, artist=TRAP_NAME)
                (root / tiff_folder / tiff_fmt.format(n=n)).write_bytes(tif)
            # sidecar acquisition file naming an operator: the code must never open it
            (root / tiff_folder / tiff_fmt.format(n=n)).with_suffix(".txt").write_text(
                f"Directory=C:\\Users\\PC-SEM\\{TRAP_NAME}\\scan\n", encoding="utf-8")
        (root / folder / counts_name).write_text("\n".join(lines), encoding="utf-8")
        if first:  # derived folders that the index must ignore
            for derived in ("bead/bead_crop/image", "fibre/fibre_1crop/label_index"):
                (root / derived).mkdir(parents=True, exist_ok=True)
                (root / derived / "x.png").write_bytes(png(np.zeros((64, 64), np.uint8)))
            first = False
    return root


def mini_scale(n: int) -> float:
    """um per PNG pixel of the miniature photo number ``n``: PixelSize x TIFF/PNG widths."""
    return (500 + 10 * n) / 1000.0 * TIFF_W / IMG_W
