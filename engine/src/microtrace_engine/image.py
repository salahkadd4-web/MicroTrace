"""Image model lock, lazy verified loading and conversions to the API models (C6).

Nothing here logs: no file name, no pixel, no metadata, no weights path.
"""
from __future__ import annotations

import base64
import json
import math
from collections.abc import Callable, Iterable, Sequence
from importlib import resources
from pathlib import Path
from typing import Any

import numpy as np
from microtrace_core.imaging.model import (
    ANALYSIS_MAX_SIDE,
    CORRECTION_SHAPES,
    MIN_CONTRAST,
    UNSPECIFIED,
    ImageAnalysis,
    ImageModel,
    Validated,
    apply_corrections,
    load_model_bytes,
)
from microtrace_core.imaging.reading import MAX_IMAGE_BYTES, MAX_PIXELS, DecodedImage
from microtrace_core.imaging.render import annotated_png, png_bytes
from microtrace_core.imaging.shape import SHAPES, UNEVALUATED_SHAPES

from . import image_text as text
from .schemas import (
    ImageAnalyzeResponse,
    ImageImagesModel,
    ImageInputModel,
    ImageMetricsModel,
    ImageModelInfo,
    ImageModelRef,
    ImageParticleModel,
    ImageReasonModel,
    ImageRecordedAnalysis,
    ImageScaleModel,
    ImageShapeCountModel,
    ImageShapeOptionModel,
    ImageSizeBinModel,
    ImageSizeDistributionModel,
    ImageThresholdsModel,
    ImageValidatedSummary,
)
from .spectral import ModelLock, ModelState, SpectralModelStore

__all__ = [
    "ImageModelStore", "ModelLock", "ModelState", "MAX_IMAGE_BYTES", "read_image_lock",
    "parse_scale", "recorded_problem", "to_model_info", "to_response", "to_validated", "shape_vocabulary",
]

LOCK_RESOURCE = "image_model.lock.json"
READING_RESOURCE = "image_model.reading.json"


def _read_reading() -> dict[str, Any]:
    """End-to-end shape figures of the model card, copied from the manifest (a test keeps them
    equal), shown next to the favourable figure of the archive."""
    try:
        raw = resources.files(__package__).joinpath(READING_RESOURCE).read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def read_image_lock() -> ModelLock:
    raw = resources.files(__package__).joinpath(LOCK_RESOURCE).read_text(encoding="utf-8")
    data = json.loads(raw)
    return ModelLock(name=data["name"], version=data["version"], file=data["file"],
                     sha256=data["sha256"])


class ImageModelStore(SpectralModelStore):
    """Same lazy, cached, sha256-before-``np.load`` loading as the spectral store, for the
    image model archive."""

    def __init__(self, models_dir: Path, lock: ModelLock,
                 loader: Callable[[bytes], ImageModel] = load_model_bytes) -> None:
        super().__init__(models_dir, lock, loader=loader)  # type: ignore[arg-type]

    def get(self) -> tuple[ModelState, ImageModel | None, str | None]:  # type: ignore[override]
        return super().get()  # type: ignore[return-value]


# --- scale input (design 7.1) -------------------------------------------------------------------

def parse_scale(raw: str | None) -> tuple[float | None, str | None]:
    """(micrometres per pixel of the deposited image or None, French 422 message or None)."""
    given = (raw or "").strip()
    if not given:
        return None, None
    try:
        value = float(given.replace(",", "."))
    except ValueError:
        return None, text.BAD_SCALE
    if not math.isfinite(value) or not (text.SCALE_MIN_INPUT <= value <= text.SCALE_MAX_INPUT):
        return None, text.BAD_SCALE
    return value, None


# --- conversions --------------------------------------------------------------------------------

def _f(v: Any) -> float:
    x = float(v)
    return x if math.isfinite(x) else 0.0


def shape_vocabulary() -> list[ImageShapeOptionModel]:
    return [ImageShapeOptionModel(code=s, label=text.shape_label(s),  # type: ignore[arg-type]
                                  evaluated=s not in UNEVALUATED_SHAPES)
            for s in (*SHAPES, *UNEVALUATED_SHAPES)]


def _thresholds(model: ImageModel) -> ImageThresholdsModel:
    s = model.settings
    return ImageThresholdsModel(pixel=s.pixel_threshold, min_area_frac=s.min_area_frac,
                                shape_min_score=s.shape_min_score,
                                max_foreground=s.max_foreground, min_contrast=float(MIN_CONTRAST))


def _shape_counts(by_shape: dict[str, int], codes: Iterable[str]) -> list[ImageShapeCountModel]:
    return [ImageShapeCountModel(shape=c, label=text.shape_label(c),  # type: ignore[arg-type]
                                 count=int(by_shape.get(c, 0))) for c in codes]


def _percentiles(values: Sequence[float]) -> tuple[float | None, float | None, float | None]:
    if not len(values):
        return None, None, None
    p10, med, p90 = np.percentile(np.asarray(values, dtype=np.float64), [10, 50, 90])
    return _f(med), _f(p10), _f(p90)


def _distribution(bins, feret_um: Sequence[float]) -> ImageSizeDistributionModel:
    median, p10, p90 = _percentiles(feret_um)
    return ImageSizeDistributionModel(
        basis=text.SIZE_BASIS,  # type: ignore[arg-type]
        bins=[ImageSizeBinModel(lower=b.lower, upper=None if math.isinf(b.upper) else b.upper,
                                label=text.size_label(b.lower, b.upper), count=b.count)
              for b in bins],
        median_um=median, p10_um=p10, p90_um=p90)


def _particle(sp, scale: float | None, shape_min_score: float) -> ImageParticleModel:
    p = sp.particle
    shape = sp.shape if sp.confident else text.UNCERTAIN
    um = (lambda v: None) if scale is None else (lambda v: _f(v * scale))
    return ImageParticleModel(
        id=p.id, contour=[[round(_f(x), 2), round(_f(y), 2)] for x, y in p.contour],
        bbox=[int(v) for v in p.bbox], area_px=_f(p.area_px), feret_max_px=_f(p.feret_max_px),
        feret_min_px=_f(p.feret_min_px),
        area_um2=None if scale is None else _f(p.area_px * scale * scale),
        feret_max_um=um(p.feret_max_px), feret_min_um=um(p.feret_min_px),
        eq_diameter_um=um(p.eq_diameter_px), circularity=_f(p.circularity),
        solidity=_f(p.solidity), elongation=_f(p.elongation),
        touches_border=bool(p.touches_border), shape=shape,  # type: ignore[arg-type]
        shape_label=text.shape_label(shape), shape_score=_f(sp.shape_score),
        shape_score_text=text.shape_score_text(sp.shape_score, shape_min_score, sp.confident),
        shape_status="proposed" if sp.confident else "uncertain")


def to_response(model: ImageModel, sha256: str, analysis: ImageAnalysis, decoded: DecodedImage, *,
                data_sha256: str, size: int) -> ImageAnalyzeResponse:
    s = model.settings
    scale = analysis.scale
    factor = None if scale is None else scale.um_per_px_analysis
    particles = [_particle(sp, factor, s.shape_min_score) for sp in analysis.particles]
    by_shape: dict[str, int] = {}
    for p in particles:
        by_shape[p.shape] = by_shape.get(p.shape, 0) + 1
    reasons = [r.value for r in analysis.reasons]
    aw, ah = analysis.analysis_size
    distribution = None
    if analysis.size_bins is not None and factor is not None:
        distribution = _distribution(analysis.size_bins, [
            sp.particle.feret_max_px * factor for sp in analysis.particles])
    scale_model = None
    if scale is not None:
        scale_model = ImageScaleModel(
            um_per_px_input=scale.um_per_px_input, um_per_px_analysis=scale.um_per_px_analysis,
            source=scale.source.value,  # type: ignore[arg-type]
            source_label=text.SCALE_SOURCE_LABELS[scale.source.value],
            min_detectable_um=_f(analysis.min_detectable_px * scale.um_per_px_analysis))
    explanation = text.explanation(
        status=analysis.status.value, reasons=reasons, count=analysis.count, by_shape=by_shape,
        min_detectable=(scale_model.min_detectable_um if scale_model is not None
                        else analysis.min_detectable_px),
        has_scale=scale is not None, foreground=analysis.foreground,
        max_foreground=s.max_foreground,
        scale_um_per_px=None if scale is None else scale.um_per_px_analysis,
        scale_min=s.scale_min, scale_max=s.scale_max)
    return ImageAnalyzeResponse(
        model=ImageModelRef(name=model.name, version=model.version, sha256=sha256),
        trial_label=text.TRIAL_LABEL, trial_sentence=text.TRIAL_SENTENCE,
        input=ImageInputModel(
            sha256=data_sha256, size=size, format=decoded.format,  # type: ignore[arg-type]
            width=decoded.width, height=decoded.height, bit_depth=decoded.bit_depth,
            color=decoded.color,  # type: ignore[arg-type]
            orientation_applied=decoded.orientation_applied, alpha_ignored=decoded.alpha_ignored,
            cropped_bottom_px=decoded.cropped_bottom_px, analysis_width=aw, analysis_height=ah,
            downscale=_f(analysis.downscale)),
        scale=scale_model, status=analysis.status.value,  # type: ignore[arg-type]
        status_label=text.status_label(analysis.status.value),
        reasons=[ImageReasonModel(code=r, label=text.REASON_LABELS[r])  # type: ignore[arg-type]
                 for r in reasons],
        explanation=explanation, count=analysis.count,
        count_by_shape=_shape_counts(by_shape, text.SHAPE_ORDER), particles=particles,
        size_distribution=distribution,
        images=ImageImagesModel(
            display_png_base64=base64.b64encode(png_bytes(analysis.analysis_gray)).decode("ascii"),
            annotated_png_base64=base64.b64encode(
                annotated_png(analysis.analysis_gray, analysis.particles)).decode("ascii")),
        thresholds=_thresholds(model), limits=list(text.LIMITS),
        shape_vocabulary=shape_vocabulary())


def _metrics(model: ImageModel) -> ImageMetricsModel | None:
    block = model.meta.get("metrics") if isinstance(model.meta, dict) else None
    if not isinstance(block, dict):
        return None

    def num(key: str) -> float | None:
        v = block.get(key)
        return _f(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    tests = block.get("test_images")
    reading = _read_reading()

    def rnum(key: str) -> float | None:
        v = reading.get(key)
        return _f(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    def rint(key: str) -> int | None:
        v = reading.get(key)
        return v if isinstance(v, int) and not isinstance(v, bool) else None

    return ImageMetricsModel(
        shape_proposed_accuracy=rnum("shape_proposed_accuracy"),
        shape_proposed_balanced_accuracy=rnum("shape_proposed_balanced_accuracy"),
        shape_proposed_n=rint("shape_proposed_n"), bead_shape_correct=rint("bead_shape_correct"),
        bead_shape_n=rint("bead_shape_n"),
        bead_feret_rel_err_median=rnum("bead_feret_rel_err_median"),
        test_images=int(tests) if isinstance(tests, int) and not isinstance(tests, bool) else None,
        f1_objects=num("f1_objects"), count_mae=num("count_mae"), dice=num("dice"),
        shape_balanced_accuracy=num("shape_balanced_accuracy"),
        unreliable_share=num("unreliable_share"))


def to_model_info(store: ImageModelStore) -> ImageModelInfo:
    state, model, sha = store.get()
    lock = store.lock
    ok = state is ModelState.OK and model is not None
    return ImageModelInfo(
        available=ok, reason=None if ok else state.value,  # type: ignore[arg-type]
        message=None if ok else text.UNAVAILABLE[state.value], name=lock.name,
        version=lock.version, expected_sha256=lock.sha256, sha256=sha if ok else None,
        trial_label=text.TRIAL_LABEL, trial_sentence=text.TRIAL_SENTENCE,
        limits=list(text.LIMITS), card_path=text.CARD_PATH, max_bytes=MAX_IMAGE_BYTES,
        max_pixels=MAX_PIXELS, analysis_max_side=ANALYSIS_MAX_SIDE,
        shape_vocabulary=shape_vocabulary(),
        thresholds=_thresholds(model) if ok and model is not None else None,
        metrics=_metrics(model) if ok and model is not None else None,
        training_data=text.TRAINING_DATA)


# --- human decision (design 7.7): no access to the weights -------------------------------------

RECORDED_SHAPES = (*SHAPES, text.UNCERTAIN)  # what the model can propose; never "film"


def recorded_problem(analysis: ImageRecordedAnalysis) -> str | None:
    """The French 422 message when the recorded analysis contradicts itself, else None."""
    seen: set[int] = set()
    for p in analysis.particles:
        if p.id in seen:
            return text.recorded_problem("duplicate_id", p.id)
        seen.add(p.id)
        if p.shape not in RECORDED_SHAPES:
            return text.recorded_problem("shape", p.id)
    if analysis.count != len(analysis.particles):
        return text.recorded_problem("count", analysis.count, len(analysis.particles))
    return None


def to_validated(analysis: ImageRecordedAnalysis, excluded: Sequence[int],
                 reshaped: Sequence[tuple[int, str]], missed: int) -> ImageValidatedSummary:
    """Raises ``CorrectionError`` (a person's decision contradicting the recorded analysis)."""
    factor = None if analysis.scale is None else analysis.scale.um_per_px_analysis
    rows = [p.model_dump() for p in analysis.particles]
    result: Validated = apply_corrections(rows, factor, excluded, reshaped, missed)
    drop = {int(i) for i in excluded}
    distribution = None
    if result.size_bins is not None and factor is not None:
        distribution = _distribution(result.size_bins, [
            p.feret_max_px * factor for p in analysis.particles if p.id not in drop])
    codes = (*CORRECTION_SHAPES, text.UNCERTAIN, UNSPECIFIED)
    return ImageValidatedSummary(
        count=result.count, kept=result.kept, excluded=result.excluded, missed=result.missed,
        count_by_shape=_shape_counts(dict(result.by_shape), codes), size_distribution=distribution,
        changes=result.changes,
        sentence=text.validated_sentence(result.count, result.kept, result.excluded,
                                         result.missed))
