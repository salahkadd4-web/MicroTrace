"""Model weights as a deterministic, pickle-free ``.npz`` archive."""
from __future__ import annotations

import hashlib
import io
import json
import zipfile
from collections.abc import Mapping
from pathlib import Path

import numpy as np

from microtrace_core.preprocess import GRIDS
from microtrace_core.spectral.model import (
    PLOT_STRIDE,
    SpectralModel,
    SvmParams,
    TechniqueModel,
    window_mask,
)
from microtrace_core.spectral.thresholds import Thresholds
from microtrace_core.spectrum import Technique

FIXED_DATE = (1980, 1, 1, 0, 0, 0)
_TECHNIQUES: tuple[Technique, ...] = ("ftir_atr", "raman")
_PER_TECHNIQUE = (
    "refs", "plot", "plot_x", "ids", "labels", "sources", "pca_mean", "pca_components",
    "svm_support_vectors", "svm_dual_coef", "svm_intercept", "svm_n_support",
    "svm_classes", "svm_gamma",
)


def archive_bytes(arrays: Mapping[str, np.ndarray]) -> bytes:
    """Serialise arrays to a byte-deterministic zip of ``.npy`` files (sorted names)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name in sorted(arrays):
            arr = np.asarray(arrays[name])
            if arr.dtype.hasobject:
                raise ValueError(f"array {name!r} has object dtype: pickle is not allowed")
            body = io.BytesIO()
            np.lib.format.write_array(body, arr, version=(1, 0), allow_pickle=False)
            info = zipfile.ZipInfo(f"{name}.npy", date_time=FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o600 << 16
            zf.writestr(info, body.getvalue(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    return buf.getvalue()


def write_archive(path: Path, arrays: Mapping[str, np.ndarray]) -> str:
    """Write the archive and return its sha256 (hex)."""
    data = archive_bytes(arrays)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def read_archive(data: bytes) -> dict[str, np.ndarray]:
    try:
        with np.load(io.BytesIO(data), allow_pickle=False) as z:
            return {k: z[k] for k in z.files}
    except Exception as exc:  # noqa: BLE001 - any unreadable archive is invalid
        raise ValueError(f"invalid model archive: unreadable ({type(exc).__name__})") from None


def _unicode(values) -> np.ndarray:
    return np.asarray([str(v) for v in values], dtype=str)


def model_to_arrays(m: SpectralModel) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    thresholds = {}
    for t, tm in m.techniques.items():
        p = f"{t}/"
        out[p + "refs"] = np.asarray(tm.refs, dtype=np.float32)
        out[p + "plot"] = np.asarray(tm.plot, dtype=np.float16)
        out[p + "plot_x"] = np.asarray(tm.plot_x, dtype=np.float32)
        out[p + "ids"] = _unicode(tm.ids)
        out[p + "labels"] = _unicode(tm.labels)
        out[p + "sources"] = _unicode(tm.sources)
        out[p + "pca_mean"] = np.asarray(tm.pca_mean, dtype=np.float64)
        out[p + "pca_components"] = np.asarray(tm.pca_components, dtype=np.float64)
        out[p + "svm_support_vectors"] = np.asarray(tm.svm.support_vectors, dtype=np.float64)
        out[p + "svm_dual_coef"] = np.asarray(tm.svm.dual_coef, dtype=np.float64)
        out[p + "svm_intercept"] = np.asarray(tm.svm.intercept, dtype=np.float64)
        out[p + "svm_n_support"] = np.asarray(tm.svm.n_support, dtype=np.int64)
        out[p + "svm_classes"] = _unicode(tm.svm.classes)
        out[p + "svm_gamma"] = np.asarray(tm.svm.gamma, dtype=np.float64)
        thresholds[t] = {
            "uncertain_min_score": tm.thresholds.uncertain_min_score,
            "identified_min_score": tm.thresholds.identified_min_score,
            "identified_min_margin": tm.thresholds.identified_min_margin,
        }
    meta = {"name": m.name, "version": m.version, "thresholds": thresholds,
            "meta": dict(m.meta)}
    out["meta"] = np.asarray(json.dumps(meta, sort_keys=True, ensure_ascii=False))
    return out


def _invalid(reason: str) -> ValueError:
    return ValueError(f"invalid model archive: {reason}")


def model_from_arrays(a: Mapping[str, np.ndarray]) -> SpectralModel:
    try:
        meta = json.loads(str(a["meta"]))
        techniques: dict[Technique, TechniqueModel] = {}
        for t in _TECHNIQUES:
            if not any(k.startswith(f"{t}/") for k in a):
                continue
            missing = [k for k in _PER_TECHNIQUE if f"{t}/{k}" not in a]
            if missing:
                raise _invalid(f"missing key {t}/{missing[0]}")
            g = {k: a[f"{t}/{k}"] for k in _PER_TECHNIQUE}
            n, n_window = g["refs"].shape
            if n_window != int(window_mask(t).sum()):
                raise _invalid(f"{t}: wrong window size")
            if g["plot"].shape != (n, len(GRIDS[t][::PLOT_STRIDE])):
                raise _invalid(f"{t}: wrong plot shape")
            if not (len(g["ids"]) == len(g["labels"]) == len(g["sources"]) == n):
                raise _invalid(f"{t}: inconsistent reference metadata")
            if g["pca_components"].shape[1] != n_window or g["pca_mean"].shape != (n_window,):
                raise _invalid(f"{t}: wrong PCA shape")
            n_comp = g["pca_components"].shape[0]
            if g["svm_support_vectors"].ndim != 2 or g["svm_support_vectors"].shape[1] != n_comp:
                raise _invalid(f"{t}: wrong SVM shape")
            if int(g["svm_n_support"].sum()) != len(g["svm_support_vectors"]):
                raise _invalid(f"{t}: wrong SVM support count")
            th = meta["thresholds"][t]
            techniques[t] = TechniqueModel(
                technique=t, refs=g["refs"], plot=g["plot"], plot_x=g["plot_x"],
                ids=g["ids"], labels=g["labels"], sources=g["sources"],
                pca_mean=g["pca_mean"], pca_components=g["pca_components"],
                svm=SvmParams(
                    classes=g["svm_classes"], support_vectors=g["svm_support_vectors"],
                    dual_coef=g["svm_dual_coef"], intercept=g["svm_intercept"],
                    n_support=g["svm_n_support"], gamma=float(g["svm_gamma"])),
                thresholds=Thresholds(
                    float(th["uncertain_min_score"]), float(th["identified_min_score"]),
                    float(th["identified_min_margin"])))
        if not techniques:
            raise _invalid("no technique")
        return SpectralModel(name=str(meta["name"]), version=str(meta["version"]),
                             techniques=techniques, meta=meta["meta"])
    except ValueError as exc:
        if str(exc).startswith("invalid model archive"):
            raise
        raise _invalid("malformed content") from None
    except (KeyError, TypeError, IndexError, AttributeError) as exc:
        raise _invalid(f"missing or malformed key ({type(exc).__name__})") from None


def load_model_bytes(data: bytes) -> SpectralModel:
    return model_from_arrays(read_archive(data))
