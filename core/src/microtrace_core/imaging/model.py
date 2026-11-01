"""Serving side of the image model: segmentation, scale, status and abstention, corrections.

No scikit-learn here: inference needs numpy, scipy, Pillow and scikit-image only.
"""
from __future__ import annotations

import json
import math
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import measure, morphology

from microtrace_core.archive import read_archive
from microtrace_core.imaging import features
from microtrace_core.imaging import forest as forest_mod
from microtrace_core.imaging.forest import Forest
from microtrace_core.imaging.geometry import Particle, particles_from_labels
from microtrace_core.imaging.reading import DecodedImage
from microtrace_core.imaging.shape import (
    SHAPES,
    UNEVALUATED_SHAPES,
    ShapeModel,
    shape_features,
    shape_proba,
)

ANALYSIS_MAX_SIDE = 1024
MAX_PARTICLES = 300
MIN_CONTRAST = 10
SCALE_MISMATCH_TOLERANCE = 0.02
SIZE_BINS_UM = (0, 10, 20, 50, 100, 200, 500, 1000, 5000, math.inf)
OPENING_RADIUS = 2
CORRECTION_SHAPES = SHAPES + UNEVALUATED_SHAPES
UNSPECIFIED = "unspecified"
MAX_MISSED = 10_000


class Status(StrEnum):
    PROPOSAL = "proposal"
    UNRELIABLE = "unreliable"


class Reason(StrEnum):
    NO_PARTICLE = "no_particle"
    TOO_MANY_PARTICLES = "too_many_particles"
    LARGE_FOREGROUND = "large_foreground"
    LOW_CONTRAST = "low_contrast"
    SCALE_OUT_OF_RANGE = "scale_out_of_range"


class ScaleSource(StrEnum):
    METADATA = "metadata"
    ENTERED = "entered"
    NONE = "none"


class ScaleMismatch(ValueError):
    def __init__(self, entered: float, metadata: float) -> None:
        super().__init__("scale_mismatch")
        self.entered = entered
        self.metadata = metadata


@dataclass(frozen=True)
class Settings:
    pixel_threshold: float
    min_area_frac: float
    shape_min_score: float
    max_foreground: float
    scale_min: float  # um per pixel of the analysis image
    scale_max: float


@dataclass(frozen=True)
class ImageModel:
    name: str
    version: str
    forest: Forest
    shape: ShapeModel
    settings: Settings
    meta: Mapping[str, object]


@dataclass(frozen=True)
class Scale:
    um_per_px_input: float
    um_per_px_analysis: float
    source: ScaleSource


@dataclass(frozen=True)
class ScoredParticle:
    particle: Particle
    shape: str
    shape_score: float
    confident: bool


@dataclass(frozen=True)
class SizeBin:
    lower: float
    upper: float
    count: int


@dataclass(frozen=True)
class ImageAnalysis:
    status: Status
    reasons: tuple[Reason, ...]
    scale: Scale | None
    analysis_size: tuple[int, int]  # (width, height)
    downscale: float
    foreground: float
    particles: tuple[ScoredParticle, ...]
    count: int  # particles proposed (== len(particles); at most MAX_PARTICLES)
    size_bins: tuple[SizeBin, ...] | None
    min_detectable_px: float  # equivalent diameter, analysis pixels
    analysis_gray: np.ndarray


# ------------------------------------------------------------------ scale

def resolve_scale(decoded: DecodedImage, entered: float | None, analysis_width: int) -> Scale | None:
    """The scale of the analysis image, from the file's metadata and/or the entered value.

    ``entered`` is um per pixel of the deposited image. A value that contradicts the metadata by
    more than ``SCALE_MISMATCH_TOLERANCE`` is refused.
    """
    if entered is not None and not (math.isfinite(entered) and entered > 0):
        raise ValueError("entered scale must be a positive finite number")
    meta = decoded.metadata_um_per_px
    ratio = decoded.width / analysis_width
    if meta is not None:
        if entered is not None and abs(entered - meta) / meta > SCALE_MISMATCH_TOLERANCE:
            raise ScaleMismatch(entered, meta)
        return Scale(meta, meta * ratio, ScaleSource.METADATA)
    if entered is not None:
        return Scale(entered, entered * ratio, ScaleSource.ENTERED)
    return None


# ------------------------------------------------------------------ segmentation

def analysis_size(height: int, width: int) -> tuple[int, int]:
    """(width, height) of the analysis image: longest side at most ANALYSIS_MAX_SIDE."""
    longest = max(height, width)
    if longest <= ANALYSIS_MAX_SIDE:
        return width, height
    f = ANALYSIS_MAX_SIDE / longest
    return max(1, round(width * f)), max(1, round(height * f))


def to_analysis(gray: np.ndarray) -> np.ndarray:
    """The gray image reduced (bilinear, anti-aliased) to the analysis size."""
    h, w = gray.shape
    nw, nh = analysis_size(h, w)
    if (nw, nh) == (w, h):
        return np.ascontiguousarray(gray)
    return np.asarray(Image.fromarray(gray).resize((nw, nh), Image.Resampling.BILINEAR))


def pixel_probability(forest: Forest, gray: np.ndarray) -> np.ndarray:
    """Per-pixel probability of "particle" (float32, image shape)."""
    feats = features.pixel_features(features.normalise(gray))
    h, w, n = feats.shape
    return forest_mod.forest_proba(forest, feats.reshape(h * w, n)).reshape(h, w)


def postprocess(prob: np.ndarray, threshold: float, min_area_frac: float) -> np.ndarray:
    """Threshold, open (disk 2), fill holes, label (8-connectivity), drop small components."""
    mask = prob >= threshold
    if not mask.any():
        return np.zeros(prob.shape, dtype=np.int32)
    mask = morphology.opening(mask, morphology.disk(OPENING_RADIUS))
    mask = ndi.binary_fill_holes(mask)
    labels = measure.label(mask, connectivity=2).astype(np.int32)
    if labels.max() == 0:
        return labels
    counts = np.bincount(labels.ravel())
    keep = counts >= max(1.0, min_area_frac * prob.size)
    keep[0] = False
    new = np.cumsum(keep).astype(np.int32)
    new[~keep] = 0
    return new[labels]


def segment(model: ImageModel, gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(probability map, label image) of an analysis-sized gray image."""
    prob = pixel_probability(model.forest, gray)
    s = model.settings
    return prob, postprocess(prob, s.pixel_threshold, s.min_area_frac)


# ------------------------------------------------------------------ analysis

def size_distribution(feret_um: Sequence[float]) -> tuple[SizeBin, ...]:
    """Counts per size class (lower bound included), on the maximum Feret diameter."""
    values = np.asarray(list(feret_um), dtype=np.float64)
    bins = []
    for lo, hi in zip(SIZE_BINS_UM[:-1], SIZE_BINS_UM[1:], strict=True):
        n = int(((values >= lo) & (values < hi)).sum()) if len(values) else 0
        bins.append(SizeBin(float(lo), float(hi), n))
    return tuple(bins)


def classify(model: ImageModel, particles: Sequence[Particle]) -> list[ScoredParticle]:
    """Shape and score of each particle; ``film`` is not a class of the model."""
    if not particles:
        return []
    proba = shape_proba(model.shape, np.stack([shape_features(p) for p in particles]))
    best = proba.argmax(axis=1)
    return [ScoredParticle(p, model.shape.classes[int(k)], float(proba[i, k]),
                           bool(proba[i, k] >= model.settings.shape_min_score))
            for i, (p, k) in enumerate(zip(particles, best, strict=True))]


def analyze(model: ImageModel, decoded: DecodedImage, entered_um_per_px: float | None
            ) -> ImageAnalysis:
    return analyze_with_labels(model, decoded, entered_um_per_px)[0]


def analyze_with_labels(model: ImageModel, decoded: DecodedImage, entered_um_per_px: float | None
                        ) -> tuple[ImageAnalysis, np.ndarray]:
    """``analyze`` plus the label image of every kept component (evaluation uses it)."""
    h, w = decoded.gray.shape
    aw, ah = analysis_size(h, w)
    scale = resolve_scale(decoded, entered_um_per_px, aw)  # may raise ScaleMismatch
    gray = to_analysis(decoded.gray)
    _, labels = segment(model, gray)
    s = model.settings

    counts = np.bincount(labels.ravel()) if labels.size else np.zeros(1, int)
    n_components = int((counts[1:] > 0).sum())
    foreground = float((labels > 0).mean()) if labels.size else 0.0
    particles = classify(model, particles_from_labels(labels, limit=MAX_PARTICLES))

    reasons: list[Reason] = []
    if n_components == 0:
        reasons.append(Reason.NO_PARTICLE)
    if n_components > MAX_PARTICLES:
        reasons.append(Reason.TOO_MANY_PARTICLES)
    if foreground > s.max_foreground:
        reasons.append(Reason.LARGE_FOREGROUND)
    if decoded.contrast < MIN_CONTRAST:
        reasons.append(Reason.LOW_CONTRAST)
    if scale is not None and not (s.scale_min <= scale.um_per_px_analysis <= s.scale_max):
        reasons.append(Reason.SCALE_OUT_OF_RANGE)

    bins = None
    if scale is not None:
        bins = size_distribution([sp.particle.feret_max_px * scale.um_per_px_analysis
                                  for sp in particles])
    gh, gw = gray.shape
    analysis = ImageAnalysis(
        status=Status.UNRELIABLE if reasons else Status.PROPOSAL, reasons=tuple(reasons),
        scale=scale, analysis_size=(gw, gh), downscale=w / gw, foreground=foreground,
        particles=tuple(particles), count=len(particles), size_bins=bins,
        min_detectable_px=2.0 * math.sqrt(s.min_area_frac * gh * gw / math.pi),
        analysis_gray=gray)
    return analysis, labels


# ------------------------------------------------------------------ human corrections

@dataclass(frozen=True)
class Validated:
    count: int
    kept: int
    excluded: int
    missed: int
    by_shape: Mapping[str, int]
    size_bins: tuple[SizeBin, ...] | None
    changes: int


class CorrectionError(ValueError):
    """code: unknown_particle | both | unknown_shape."""

    def __init__(self, code: str, particle_id: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.particle_id = particle_id


def apply_corrections(particles: Sequence[Mapping], scale_um_per_px: float | None,
                      excluded: Sequence[int], reshaped: Sequence[tuple[int, str]],
                      missed: int) -> Validated:
    """Apply a person's corrections to a recorded proposal.

    ``particles`` are the recorded mappings (``id``, ``shape``, optionally ``feret_max_px``);
    ``scale_um_per_px`` is the analysis-image scale (None: no size classes).
    """
    if not 0 <= int(missed) <= MAX_MISSED:
        raise ValueError("missed count out of range")
    by_id = {int(p["id"]): p for p in particles}
    drop = {int(i) for i in excluded}
    if len({int(pid) for pid, _ in reshaped}) != len(reshaped):
        raise CorrectionError("duplicate", int(sorted(
            pid for pid, n in Counter(int(i) for i, _ in reshaped).items() if n > 1)[0]))
    new_shape: dict[int, str] = {}
    for pid in sorted(drop):
        if pid not in by_id:
            raise CorrectionError("unknown_particle", pid)
    for pid, shape in reshaped:
        pid = int(pid)
        if pid not in by_id:
            raise CorrectionError("unknown_particle", pid)
        if shape not in CORRECTION_SHAPES:
            raise CorrectionError("unknown_shape", pid)
        if pid in drop:
            raise CorrectionError("both", pid)
        new_shape[pid] = shape
    changes = sum(1 for pid, shape in new_shape.items() if shape != by_id[pid]["shape"])
    kept = [p for pid, p in by_id.items() if pid not in drop]
    by_shape = {s: 0 for s in CORRECTION_SHAPES}
    by_shape[UNSPECIFIED] = int(missed)
    for p in kept:
        shape = new_shape.get(int(p["id"]), p["shape"])
        by_shape[shape] = by_shape.get(shape, 0) + 1
    bins = None
    if scale_um_per_px is not None:
        sizes = [float(p["feret_max_px"]) * scale_um_per_px for p in kept
                 if p.get("feret_max_px") is not None]
        bins = size_distribution(sizes)
    return Validated(count=len(kept) + int(missed), kept=len(kept), excluded=len(drop),
                     missed=int(missed), by_shape=by_shape, size_bins=bins, changes=changes)


# ------------------------------------------------------------------ weights <-> model

_FOREST_KEYS = ("feature", "threshold", "left", "right", "value", "roots")
_SHAPE_KEYS = ("mean", "scale", "coef", "intercept", "classes")
_SETTINGS = ("pixel_threshold", "min_area_frac", "shape_min_score", "max_foreground",
             "scale_min", "scale_max")


def model_to_arrays(m: ImageModel) -> dict[str, np.ndarray]:
    f = m.forest
    out = {
        "forest/feature": np.asarray(f.feature, dtype=np.int16),
        "forest/threshold": np.asarray(f.threshold, dtype=np.float32),
        "forest/left": np.asarray(f.left, dtype=np.int32),
        "forest/right": np.asarray(f.right, dtype=np.int32),
        "forest/value": np.asarray(f.value, dtype=np.float32),
        "forest/roots": np.asarray(f.roots, dtype=np.int32),
        "shape/mean": np.asarray(m.shape.mean, dtype=np.float64),
        "shape/scale": np.asarray(m.shape.scale, dtype=np.float64),
        "shape/coef": np.asarray(m.shape.coef, dtype=np.float64),
        "shape/intercept": np.asarray(m.shape.intercept, dtype=np.float64),
        "shape/classes": np.asarray([str(c) for c in m.shape.classes], dtype=str),
    }
    meta = {"name": m.name, "version": m.version, "max_depth": int(f.max_depth),
            "settings": {k: float(getattr(m.settings, k)) for k in _SETTINGS},
            "meta": dict(m.meta)}
    out["meta"] = np.asarray(json.dumps(meta, sort_keys=True, ensure_ascii=False))
    return out


def _invalid(reason: str) -> ValueError:
    return ValueError(f"invalid model archive: {reason}")


def model_from_arrays(a: Mapping[str, np.ndarray]) -> ImageModel:
    try:
        meta = json.loads(str(a["meta"]))
        for key in _FOREST_KEYS:
            if f"forest/{key}" not in a:
                raise _invalid(f"missing key forest/{key}")
        for key in _SHAPE_KEYS:
            if f"shape/{key}" not in a:
                raise _invalid(f"missing key shape/{key}")
        fe, th, le, ri, va, ro = (a[f"forest/{k}"] for k in _FOREST_KEYS)
        n = len(fe)
        if n < 1 or not (len(th) == len(le) == len(ri) == len(va) == n):
            raise _invalid("inconsistent forest arrays")
        if fe.dtype != np.int16 or th.dtype != np.float32 or va.dtype != np.float32:
            raise _invalid("wrong forest dtypes")
        if le.dtype != np.int32 or ri.dtype != np.int32 or ro.dtype != np.int32:
            raise _invalid("wrong forest dtypes")
        if len(ro) < 1 or ro.min() < 0 or ro.max() >= n:
            raise _invalid("wrong forest roots")
        if le.min() < 0 or le.max() >= n or ri.min() < 0 or ri.max() >= n:
            raise _invalid("child index out of range")
        if int(fe.max()) >= features.N_FEATURES:
            raise _invalid("feature index out of range")
        if not np.isfinite(va).all() or va.min() < 0 or va.max() > 1:
            raise _invalid("leaf values out of range")
        max_depth = int(meta["max_depth"])
        if not 0 <= max_depth <= 64:
            raise _invalid("wrong forest depth")
        mean, scale, coef, intercept, classes = (a[f"shape/{k}"] for k in _SHAPE_KEYS)
        k = len(classes)
        if mean.shape != (6,) or scale.shape != (6,) or coef.ndim != 2 or coef.shape[1] != 6:
            raise _invalid("wrong shape-model shapes")
        if coef.shape[0] != (1 if k == 2 else k) or intercept.shape != (coef.shape[0],) or k < 2:
            raise _invalid("wrong shape-model class count")
        if not np.isfinite(scale).all() or (scale <= 0).any():
            raise _invalid("invalid shape-model scale")
        s = meta["settings"]
        settings = Settings(**{key: float(s[key]) for key in _SETTINGS})
        return ImageModel(
            name=str(meta["name"]), version=str(meta["version"]),
            forest=Forest(fe, th, le, ri, va, ro, max_depth),
            shape=ShapeModel(mean, scale, coef, intercept, tuple(str(c) for c in classes)),
            settings=settings, meta=meta["meta"])
    except ValueError as exc:
        if str(exc).startswith("invalid model archive"):
            raise
        raise _invalid("malformed content") from None
    except (KeyError, TypeError, IndexError, AttributeError) as exc:
        raise _invalid(f"missing or malformed key ({type(exc).__name__})") from None


def load_model_bytes(data: bytes) -> ImageModel:
    return model_from_arrays(read_archive(data))
