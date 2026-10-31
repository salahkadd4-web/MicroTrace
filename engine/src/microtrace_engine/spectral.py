"""Spectral model lock, lazy verified loading and conversions to the API models.

Nothing here logs: no file name, no value, no weights path.
"""
from __future__ import annotations

import hashlib
import json
import math
import threading
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from importlib import resources
from pathlib import Path
from typing import Any

import numpy as np
from microtrace_core.polymers import OTHER
from microtrace_core.preprocess import DIAGNOSTIC_WINDOWS
from microtrace_core.spectral.archive import load_model_bytes
from microtrace_core.spectral.libraries import LIBRARIES
from microtrace_core.spectral.model import Identification, SpectralModel
from microtrace_core.spectral.reading import MAX_POINTS, MAX_SPECTRUM_BYTES

from . import spectral_text as text
from .schemas import (
    PolymerOptionModel,
    SpectralCandidateModel,
    SpectralCurveModel,
    SpectralIdentifyResponse,
    SpectralInputModel,
    SpectralLibraryModel,
    SpectralMetricsModel,
    SpectralModelInfo,
    SpectralModelRef,
    SpectralReferenceModel,
    SpectralStatusShares,
    SpectralTechniqueInfo,
    SpectralThresholdsModel,
)

LOCK_RESOURCE = "spectral_model.lock.json"
# an archive larger than this is not even read (the real one is about 14 Mo)
MAX_MODEL_BYTES = 64 * 1024 * 1024
_TECHNIQUE_ORDER = ("raman", "ftir_atr")


@dataclass(frozen=True)
class ModelLock:
    name: str
    version: str
    file: str
    sha256: str


def read_lock() -> ModelLock:
    raw = resources.files(__package__).joinpath(LOCK_RESOURCE).read_text(encoding="utf-8")
    data = json.loads(raw)
    return ModelLock(name=data["name"], version=data["version"], file=data["file"],
                     sha256=data["sha256"])


class ModelState(StrEnum):
    OK = "ok"
    MISSING = "missing"
    SHA_MISMATCH = "sha_mismatch"
    INVALID = "invalid"


class SpectralModelStore:
    """Reads the weights once, checks their sha256 against the lock BEFORE any ``np.load``,
    and caches the outcome until the engine restarts."""

    def __init__(self, models_dir: Path, lock: ModelLock,
                 loader: Callable[[bytes], SpectralModel] = load_model_bytes) -> None:
        self._models_dir = Path(models_dir)
        self._lock = lock
        self._loader = loader
        self._mutex = threading.Lock()
        self._cached: tuple[ModelState, SpectralModel | None, str | None] | None = None

    @property
    def lock(self) -> ModelLock:
        return self._lock

    def get(self) -> tuple[ModelState, SpectralModel | None, str | None]:
        with self._mutex:
            if self._cached is None:
                self._cached = self._load()
            return self._cached

    def _load(self) -> tuple[ModelState, SpectralModel | None, str | None]:
        name = self._lock.file
        if not name or Path(name).name != name:
            return ModelState.INVALID, None, None
        path = self._models_dir / name
        try:
            if not path.is_file():
                return ModelState.MISSING, None, None
            if path.stat().st_size > MAX_MODEL_BYTES:
                return ModelState.INVALID, None, None
            data = path.read_bytes()
        except OSError:
            return ModelState.INVALID, None, None
        digest = hashlib.sha256(data).hexdigest()
        if digest != self._lock.sha256.lower():
            return ModelState.SHA_MISMATCH, None, digest
        try:
            model = self._loader(data)
        except Exception:  # noqa: BLE001 - any unreadable archive is "invalid"; never logged
            return ModelState.INVALID, None, digest
        return ModelState.OK, model, digest


# --- request validation (design 7.1) -----------------------------------------------------------

@dataclass(frozen=True)
class SpectrumParams:
    technique: str
    x_unit: str
    y_unit: str
    laser_nm: float | None


def validate_params(technique: str, x_unit: str, y_unit: str, laser_nm: str | None
                    ) -> tuple[SpectrumParams | None, str | None]:
    """The validated parameters, or the French 422 message."""
    if technique not in ("raman", "ftir_atr"):
        return None, text.BAD_TECHNIQUE
    if x_unit not in ("cm-1", "nm"):
        return None, text.BAD_X_UNIT
    if x_unit == "nm" and technique != "raman":
        return None, text.NM_ONLY_RAMAN
    allowed = ("intensity",) if technique == "raman" else ("absorbance", "transmittance_pct")
    if y_unit not in allowed:
        return None, text.BAD_Y_UNIT
    given = (laser_nm or "").strip()
    if technique == "ftir_atr":
        return (None, text.LASER_FORBIDDEN) if given else (
            SpectrumParams(technique, x_unit, y_unit, None), None)
    if not given:
        return None, text.LASER_REQUIRED
    try:
        laser = float(given.replace(",", "."))
    except ValueError:
        return None, text.LASER_INVALID
    if not math.isfinite(laser) or not (200.0 <= laser <= 1100.0):
        return None, text.LASER_INVALID
    return SpectrumParams(technique, x_unit, y_unit, laser), None


# --- conversions -------------------------------------------------------------------------------

def _num(v: Any) -> float:
    return float(v)


def _curve(x: np.ndarray, y: np.ndarray) -> SpectralCurveModel:
    return SpectralCurveModel(x=[round(float(v), 2) for v in x],
                              y=[round(float(v), 4) for v in y])


def _thresholds(t) -> SpectralThresholdsModel:
    return SpectralThresholdsModel(
        uncertain_min_score=t.uncertain_min_score, identified_min_score=t.identified_min_score,
        identified_min_margin=t.identified_min_margin, classifier_agreement_required=True)


def _options(codes) -> list[PolymerOptionModel]:
    return [PolymerOptionModel(code=c, label=text.polymer_label(c)) for c in codes]


def vocabulary() -> list[PolymerOptionModel]:
    return [PolymerOptionModel(code=c, label=label) for c, label in text.correction_vocabulary()]


def _library_fields(code: str) -> tuple[str, str, str, bool]:
    lib = LIBRARIES.get(code)
    if lib is None:
        return code, code, text.LICENCE_PENDING, False
    return lib.name, lib.citation, text.library_licence_text(lib), lib.curve_allowed


def to_response(model: SpectralModel, sha256: str, ident: Identification, *, params: SpectrumParams,
                data_sha256: str, size: int, x: np.ndarray) -> SpectralIdentifyResponse:
    technique = params.technique
    lo, hi = DIAGNOSTIC_WINDOWS[technique]
    th = ident.thresholds
    candidates = [(c.polymer, c.score) for c in ident.candidates]
    explanation = text.explanation(
        status=ident.status.value, abstention=ident.abstention.value if ident.abstention else None,
        technique=technique, coverage=ident.coverage, candidates=candidates,
        margin=ident.margin, classifier=ident.classifier, uncertain_min=th.uncertain_min_score,
        identified_min=th.identified_min_score, margin_min=th.identified_min_margin,
        other_technique=ident.other_technique, other_score=ident.other_technique_score)
    references = []
    for rank, ref in enumerate(ident.references, start=1):
        lib = LIBRARIES.get(ref.library)
        name, citation, licence, allowed = _library_fields(ref.library)
        # only a curve whose library licence allows its diffusion is ever returned (R-C5-1)
        curve = _curve(*ref.curve) if (ref.curve is not None and allowed) else None
        references.append(SpectralReferenceModel(
            rank=rank, spectrum_id=ref.spectrum_id, library=ref.library, library_name=name,
            citation=citation, licence_text=licence, polymer=ref.polymer,
            label=text.polymer_label(ref.polymer), score=ref.score,
            score_text=text.score_text(ref.score), curve=curve,
            curve_note=None if curve is not None else text.curve_note(lib)))
    return SpectralIdentifyResponse(
        model=SpectralModelRef(name=model.name, version=model.version, sha256=sha256),
        trial_label=text.TRIAL_LABEL, trial_sentence=text.TRIAL_SENTENCE,
        input=SpectralInputModel(
            sha256=data_sha256, size=size, n_points=len(x), x_min=float(np.min(x)),
            x_max=float(np.max(x)), technique=technique,  # type: ignore[arg-type]
            technique_label=text.technique_label(technique), x_unit=params.x_unit,  # type: ignore[arg-type]
            y_unit=params.y_unit,  # type: ignore[arg-type]
            laser_nm=params.laser_nm, diagnostic_coverage=ident.coverage,
            window_min=float(lo), window_max=float(hi)),
        status=ident.status.value,  # type: ignore[arg-type]
        status_label=text.status_label(ident.status.value),
        abstention=ident.abstention.value if ident.abstention else None,  # type: ignore[arg-type]
        explanation=explanation,
        candidates=[SpectralCandidateModel(
            rank=i, polymer=p, label=text.polymer_label(p), score=s, score_text=text.score_text(s))
            for i, (p, s) in enumerate(candidates, start=1)],
        margin=ident.margin, classifier_polymer=ident.classifier,
        classifier_label=text.polymer_label(ident.classifier) if ident.classifier else None,
        references=references, query_curve=_curve(*ident.query_curve),
        x_label=text.X_LABELS[technique], y_label=text.Y_LABEL, thresholds=_thresholds(th),
        limits=list(text.LIMITS), correction_vocabulary=vocabulary())


def _shares(d: dict[str, Any]) -> SpectralStatusShares:
    return SpectralStatusShares(identified=_num(d["identified"]), uncertain=_num(d["uncertain"]),
                                not_identified=_num(d["not_identified"]))


def _metrics(model: SpectralModel, technique: str) -> SpectralMetricsModel | None:
    try:
        block = model.meta["metrics"][technique]  # type: ignore[index]
        g = block["global"]
        nested = [float(v) for v in block.get("nested_identified_precision", {}).values()]
        out = g.get("status_out_of_library")
        return SpectralMetricsModel(
            n=int(g["n"]), n_in_library=int(g["n_in_library"]),
            n_out_of_library=int(g["n_out_of_library"]), top1=_num(g["top1"]), top3=_num(g["top3"]),
            status_in_library=_shares(g["status_in_library"]),
            status_out_of_library=_shares(out) if out and out.get("n") else None,
            nested_identified_precision_min=min(nested) if nested else None,
            nested_identified_precision_max=max(nested) if nested else None)
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def to_model_info(store: SpectralModelStore) -> SpectralModelInfo:
    state, model, sha = store.get()
    lock = store.lock
    techniques: list[SpectralTechniqueInfo] = []
    counts: dict[str, dict[str, int]] = {}
    if model is not None:
        for t in _TECHNIQUE_ORDER:
            tm = model.techniques.get(t)  # type: ignore[call-overload]
            if tm is None:
                continue
            lo, hi = DIAGNOSTIC_WINDOWS[t]
            sources, n = np.unique(tm.sources, return_counts=True)
            counts[t] = {str(s): int(c) for s, c in zip(sources, n, strict=True)}
            codes = sorted({str(c) for c in tm.labels} - {OTHER})
            techniques.append(SpectralTechniqueInfo(
                technique=t, label=text.technique_label(t), n_references=len(tm.labels),  # type: ignore[arg-type]
                polymers=sorted(_options(codes), key=lambda o: o.label),
                window_min=float(lo), window_max=float(hi), thresholds=_thresholds(tm.thresholds),
                metrics=_metrics(model, t)))
    libraries = []
    for lib in LIBRARIES.values():
        libraries.append(SpectralLibraryModel(
            code=lib.code, name=lib.name, citation=lib.citation,
            licence_text=text.library_licence_text(lib), curve_allowed=lib.curve_allowed,
            n_ftir_atr=counts.get("ftir_atr", {}).get(lib.code, 0),
            n_raman=counts.get("raman", {}).get(lib.code, 0)))
    ok = state is ModelState.OK
    return SpectralModelInfo(
        available=ok, reason=None if ok else state.value,  # type: ignore[arg-type]
        message=None if ok else text.UNAVAILABLE[state.value], name=lock.name,
        version=lock.version, expected_sha256=lock.sha256, sha256=sha if ok else None,
        trial_label=text.TRIAL_LABEL, trial_sentence=text.TRIAL_SENTENCE,
        limits=list(text.LIMITS), card_path=text.CARD_PATH, max_bytes=MAX_SPECTRUM_BYTES,
        max_points=MAX_POINTS, techniques=techniques, libraries=libraries)
