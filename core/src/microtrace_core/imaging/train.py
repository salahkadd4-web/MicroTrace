"""Training and evaluation of the image model i1 (pixel forest + shape classifier).

The only module of the package that imports scikit-learn (extra ``core[train,imaging]``).
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import platform
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import replace
from datetime import date
from pathlib import Path

import numpy as np
import PIL
import scipy
import skimage
import sklearn
from scipy import ndimage as ndi
from skimage import filters
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression

from microtrace_core.archive import archive_bytes
from microtrace_core.catalog import _git_commit, _git_dirty
from microtrace_core.imaging import (
    IMAGE_MODEL_NAME,
    IMAGE_MODEL_VERSION,
    SEED,
)
from microtrace_core.imaging import forest as forest_mod
from microtrace_core.imaging.dataset import Item, build_index, load_mask
from microtrace_core.imaging.evaluate import (
    evaluate_split,
    gt_instances,
    label_ids_by_area,
    match_instances,
)
from microtrace_core.imaging.features import N_FEATURES, normalise, pixel_features
from microtrace_core.imaging.forest import Forest, forest_from_sklearn
from microtrace_core.imaging.geometry import MAX_CONTOUR_POINTS, particles_from_labels
from microtrace_core.imaging.model import (
    ANALYSIS_MAX_SIDE,
    MAX_PARTICLES,
    MIN_CONTRAST,
    SCALE_MISMATCH_TOLERANCE,
    SIZE_BINS_UM,
    ImageModel,
    Settings,
    analyze_with_labels,
    classify,
    load_model_bytes,  # noqa: F401  (re-exported for callers of the training module)
    model_from_arrays,  # noqa: F401
    model_to_arrays,
    pixel_probability,
    postprocess,
    to_analysis,
)
from microtrace_core.imaging.reading import (
    HITACHI_BAR_FRACTION,
    MAX_IMAGE_BYTES,
    MAX_PIXELS,
    MIN_SIDE,
    decode_image,
)
from microtrace_core.imaging.shape import (
    ShapeModel,
    rule_shape,
    shape_features,
    shape_proba,
)
from microtrace_core.spectral.train import BEGIN_MARKER, END_MARKER, replace_metrics_block

MODEL_FILE = "c6-microscopie-i1.npz"
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
EXPECTED_IMAGES = 237
GRID_PIXEL_THRESHOLD = (0.5, 0.6, 0.7, 0.8)
GRID_MIN_AREA_FRAC = (0.0005, 0.001, 0.002, 0.005, 0.01)
GRID_SHAPE_MIN_SCORE = (0.5, 0.6, 0.7, 0.8)
GRID_MAX_FOREGROUND = (0.2, 0.25, 0.3, 0.4)
SHAPE_ACCURACY_FLOOR = 0.90
MAX_ABSTAINED_SHARE = 0.10
FOREST_TREES = 60
FOREST_DEPTH = 14
FOREST_LEAF = 20
PIXELS_PER_CLASS = 1500
SHAPE_COMPONENT_MIN_FRAC = 0.0005  # components of the reference mask kept to learn shapes
REASONS = ("no_particle", "too_many_particles", "large_foreground", "low_contrast",
           "scale_out_of_range")
NUMPY_CHECK_IMAGES = 5
NUMPY_TOLERANCE = 1e-6

__all__ = ["BEGIN_MARKER", "END_MARKER", "replace_metrics_block"]


class IndexMismatch(RuntimeError):
    """The index does not have the expected images, or a group lies on two sides."""


class NoSettings(RuntimeError):
    """No setting of the grids satisfies the criteria."""


class NumpyMismatch(RuntimeError):
    """The numpy forest differs from scikit-learn's."""


# ------------------------------------------------------------------ pixels of an item

def _load(item: Item):
    """(decoded image, analysis-size gray) of an item, through the production reader."""
    decoded = decode_image(Path(item.image).read_bytes())
    return decoded, to_analysis(decoded.gray)


def _analysis_scale(item: Item, decoded_width: int, analysis_width: int) -> float | None:
    if item.um_per_px is None:
        return None
    return item.um_per_px * decoded_width / analysis_width


def otsu_baseline(gray: np.ndarray, min_area_frac: float = 0.002) -> np.ndarray:
    """Reference segmentation: background removed by a gaussian of 1/8 of the image, smoothed
    (sigma 4), Otsu threshold, polarity chosen as the smaller of the two classes, then the same
    opening / filling / size filter as the model. Returns a label image."""
    g = np.asarray(gray, dtype=np.float32)
    d = ndi.gaussian_filter(g - ndi.gaussian_filter(g, min(g.shape) / 8.0), 4.0)
    if not np.ptp(d) > 0:
        return np.zeros(g.shape, dtype=np.int32)
    t = filters.threshold_otsu(d)
    above, below = d > t, d < t
    mask = above if above.mean() <= below.mean() else below
    return postprocess(mask.astype(np.float32), 0.5, min_area_frac)


# ------------------------------------------------------------------ fitting

def fit_forest(items: Sequence[Item], estimator_out: list | None = None) -> Forest:
    """Pixel forest on 1 500 pixels of each class per image. ``estimator_out`` receives the
    scikit-learn estimator (for the numpy check)."""
    rng = np.random.default_rng(SEED)
    xs: list[np.ndarray] = []
    ys: list[np.ndarray] = []
    for item in items:
        _, gray = _load(item)
        flat = load_mask(item.label, gray.shape).ravel()
        feats = pixel_features(normalise(gray)).reshape(-1, N_FEATURES)
        for cls in (False, True):
            idx = np.flatnonzero(flat == cls)
            if len(idx) > PIXELS_PER_CLASS:
                idx = np.sort(rng.choice(idx, PIXELS_PER_CLASS, replace=False))
            xs.append(feats[idx])
            ys.append(np.full(len(idx), int(cls), dtype=np.int8))
        del feats
    X, y = np.concatenate(xs), np.concatenate(ys)
    if len(np.unique(y)) < 2:
        raise ValueError("the training pixels hold a single class")
    rf = RandomForestClassifier(
        n_estimators=FOREST_TREES, max_depth=FOREST_DEPTH, min_samples_leaf=FOREST_LEAF,
        class_weight="balanced", random_state=SEED, n_jobs=2)
    rf.fit(X, y)
    if estimator_out is not None:
        estimator_out.append(rf)
    return forest_from_sklearn(rf)


def _components(item: Item) -> list:
    """Particles of the reference mask of an item (analysis size)."""
    _, gray = _load(item)
    labels = gt_instances(load_mask(item.label, gray.shape), SHAPE_COMPONENT_MIN_FRAC)
    return particles_from_labels(labels)


def fit_shape(items: Sequence[Item]) -> ShapeModel:
    """Multinomial logistic regression on the components of the reference masks."""
    rows, labels = [], []
    for item in items:
        for p in _components(item):
            rows.append(shape_features(p))
            labels.append(item.shape)
    if len(set(labels)) < 2:
        raise ValueError("the training components hold a single shape")
    X = np.stack(rows)
    mean = X.mean(axis=0)
    scale = X.std(axis=0)
    scale[scale == 0] = 1.0
    lr = LogisticRegression(C=1.0, class_weight="balanced", max_iter=2000, random_state=SEED)
    lr.fit((X - mean) / scale, labels)
    return ShapeModel(mean=mean, scale=scale, coef=lr.coef_.astype(np.float64),
                      intercept=lr.intercept_.astype(np.float64),
                      classes=tuple(str(c) for c in lr.classes_))


def _check_numpy(rf, forest: Forest, items: Sequence[Item]) -> None:
    for item in list(items)[:NUMPY_CHECK_IMAGES]:
        _, gray = _load(item)
        X = pixel_features(normalise(gray)).reshape(-1, N_FEATURES)
        got = forest_mod.forest_proba(forest, X)
        want = rf.predict_proba(X)[:, 1]
        if not np.abs(got.astype(np.float64) - want).max() <= NUMPY_TOLERANCE:
            raise NumpyMismatch("numpy forest differs from scikit-learn")


# ------------------------------------------------------------------ choice of settings

def _scale_range(items: Sequence[Item]) -> tuple[float, float]:
    """(smallest, largest) analysis-image scale in um/px over the items with a scale."""
    scales = []
    for item in items:
        if item.um_per_px is None:
            continue
        with_img = decode_image(Path(item.image).read_bytes())
        h, w = with_img.gray.shape
        aw = to_analysis(with_img.gray).shape[1]
        scales.append(item.um_per_px * w / aw)
    if not scales:
        return 0.001, 1000.0
    return min(scales), max(scales)


def choose_settings(model_forest: Forest, shape: ShapeModel, val: Sequence[Item]
                    ) -> tuple[Settings, dict]:
    """Pixel threshold, minimum size, shape score and foreground limit, on validation only.

    The scale range is provisional here (validation only); ``train`` widens it to the
    training + validation range.
    """
    cache = []
    for item in val:
        decoded, gray = _load(item)
        cache.append({
            "item": item, "prob": pixel_probability(model_forest, gray), "gray": gray,
            "mask": load_mask(item.label, gray.shape), "contrast": decoded.contrast})

    # 1. pixel threshold x minimum size: best object F1, then lowest count error, then highest
    gt_cache: dict[tuple[int, float], np.ndarray] = {}
    table = []
    for frac in GRID_MIN_AREA_FRAC:
        for k, c in enumerate(cache):
            gt_cache[(k, frac)] = gt_instances(c["mask"], frac)
    for thr in GRID_PIXEL_THRESHOLD:
        for frac in GRID_MIN_AREA_FRAC:
            tp = fp = fn = 0
            errs = []
            for k, c in enumerate(cache):
                pred = postprocess(c["prob"], thr, frac)
                gt = gt_cache[(k, frac)]
                n_match = len(match_instances(pred, gt))
                n_pred, n_gt = int(pred.max()), int(gt.max())
                tp += n_match
                fp += n_pred - n_match
                fn += n_gt - n_match
                if c["item"].count is not None:
                    errs.append(abs(n_pred - c["item"].count))
            p = tp / (tp + fp) if tp + fp else 0.0
            r = tp / (tp + fn) if tp + fn else 0.0
            f1 = 2 * p * r / (p + r) if p + r else 0.0
            table.append({"pixel_threshold": thr, "min_area_frac": frac, "f1": f1,
                          "precision": p, "recall": r, "tp": tp, "fp": fp, "fn": fn,
                          "count_mae": float(np.mean(errs)) if errs else None})
    best = max(table, key=lambda t: (round(t["f1"], 12),
                                     -(t["count_mae"] if t["count_mae"] is not None else math.inf),
                                     t["pixel_threshold"], t["min_area_frac"]))
    thr, frac = best["pixel_threshold"], best["min_area_frac"]

    # 2. shape score: smallest threshold giving >= 0.90 accuracy on the kept validation components
    scores, hits = [], []
    for item in val:
        parts = _components(item)
        if not parts:
            continue
        proba = shape_proba(shape, np.stack([shape_features(p) for p in parts]))
        top = proba.argmax(axis=1)
        for i in range(len(parts)):
            scores.append(float(proba[i, top[i]]))
            hits.append(shape.classes[int(top[i])] == item.shape)
    shape_table = []
    shape_min = None
    for s in GRID_SHAPE_MIN_SCORE:
        kept = [h for sc, h in zip(scores, hits, strict=True) if sc >= s]
        acc = float(np.mean(kept)) if kept else None
        shape_table.append({"shape_min_score": s, "kept_share": len(kept) / len(scores) if scores
                            else None, "accuracy": acc, "n_kept": len(kept)})
        if shape_min is None and acc is not None and acc >= SHAPE_ACCURACY_FLOOR:
            shape_min = s
    if shape_min is None:
        raise NoSettings("no shape score threshold reaches the accuracy floor")

    # 3. foreground limit: smallest value that abstains on at most 10 % of validation images
    stats = []
    for c in cache:
        lab = postprocess(c["prob"], thr, frac)
        n_comp = int(lab.max())
        stats.append({"fg": float((lab > 0).mean()), "other": n_comp == 0 or n_comp > MAX_PARTICLES
                      or c["contrast"] < MIN_CONTRAST})
    fg_table = []
    max_fg = None
    for g in GRID_MAX_FOREGROUND:
        share = float(np.mean([s["other"] or s["fg"] > g for s in stats])) if stats else 0.0
        fg_table.append({"max_foreground": g, "abstained_share": share})
        if max_fg is None and share <= MAX_ABSTAINED_SHARE:
            max_fg = g
    if max_fg is None:
        raise NoSettings("no foreground limit abstains on at most 10 % of validation images")

    lo, hi = _scale_range(val)
    settings = Settings(pixel_threshold=thr, min_area_frac=frac, shape_min_score=shape_min,
                        max_foreground=max_fg, scale_min=lo / 2.0, scale_max=hi * 2.0)
    details = {
        "pixel_threshold": thr, "min_area_frac": frac, "shape_min_score": shape_min,
        "max_foreground": max_fg,
        "grid_pixels": table, "grid_shape": shape_table, "grid_foreground": fg_table,
        "validation": {k: best[k] for k in ("f1", "precision", "recall", "count_mae")},
        "n_validation_images": len(val)}
    return settings, details


# ------------------------------------------------------------------ evaluation on the test

def _params() -> dict:
    return {
        "seed": SEED, "analysis_max_side": ANALYSIS_MAX_SIDE, "min_side": MIN_SIDE,
        "max_particles": MAX_PARTICLES, "max_contour_points": MAX_CONTOUR_POINTS,
        "min_contrast": MIN_CONTRAST, "scale_mismatch_tolerance": SCALE_MISMATCH_TOLERANCE,
        "size_bins_um": [b if math.isfinite(b) else "inf" for b in SIZE_BINS_UM],
        "max_image_bytes": MAX_IMAGE_BYTES, "max_pixels": MAX_PIXELS,
        "hitachi_bar_fraction": HITACHI_BAR_FRACTION,
        "forest": {"trees": FOREST_TREES, "max_depth": FOREST_DEPTH,
                   "min_samples_leaf": FOREST_LEAF, "class_weight": "balanced",
                   "pixels_per_class": PIXELS_PER_CLASS},
        "grids": {"pixel_threshold": list(GRID_PIXEL_THRESHOLD),
                  "min_area_frac": list(GRID_MIN_AREA_FRAC),
                  "shape_min_score": list(GRID_SHAPE_MIN_SCORE),
                  "max_foreground": list(GRID_MAX_FOREGROUND)},
        "shape_classifier": {"C": 1.0, "class_weight": "balanced",
                             "component_min_frac": SHAPE_COMPONENT_MIN_FRAC},
    }


def _strip(block: dict) -> dict:
    return {k: v for k, v in block.items() if k != "per_image"}


def _shape_on_components(model: ImageModel, items: Sequence[Item]) -> tuple[dict, dict]:
    """Classifier and published rules on the reference-mask components (isolates the classifier)."""
    conf_model, conf_rules = Counter(), Counter()
    for item in items:
        parts = _components(item)
        if not parts:
            continue
        for sp in classify(model, parts):
            conf_model[(item.shape, sp.shape)] += 1
        for p in parts:
            conf_rules[(item.shape, rule_shape(p))] += 1

    def summarise(conf: Counter) -> dict:
        truths = sorted({t for t, _ in conf})
        preds = sorted({p for _, p in conf} | set(truths))
        total = sum(conf.values())
        matrix = {t: {p: conf[(t, p)] for p in preds} for t in truths}
        recall = {t: (conf[(t, t)] / sum(matrix[t].values())) if sum(matrix[t].values()) else None
                  for t in truths}
        vals = [v for v in recall.values() if v is not None]
        return {"n": total, "confusion": matrix, "recall": recall,
                "accuracy": sum(conf[(t, t)] for t in truths) / total if total else None,
                "balanced_accuracy": float(np.mean(vals)) if vals else None}

    return summarise(conf_model), summarise(conf_rules)


def _abstention(per_image: Sequence[dict], statuses: Sequence[dict]) -> dict:
    n = len(statuses)
    reasons = Counter(r for s in statuses for r in s["reasons"])
    unreliable = [i for i, s in enumerate(statuses) if s["status"] == "unreliable"]
    kept = [i for i in range(n) if i not in set(unreliable)]

    def group(idx: Sequence[int]) -> dict:
        rows = [per_image[i] for i in idx]
        tp, fp, fn = (sum(r[k] for r in rows) for k in ("tp", "fp", "fn"))
        p = tp / (tp + fp) if tp + fp else None
        r_ = tp / (tp + fn) if tp + fn else None
        f1 = 2 * p * r_ / (p + r_) if p and r_ else None
        errs = [abs(r["pred_count"] - r["true_count"]) for r in rows if r["true_count"] is not None]
        return {"n_images": len(rows), "f1": f1,
                "count_mae": float(np.mean(errs)) if errs else None, "n_counted": len(errs)}

    by_subset = {}
    for subset in sorted({r["subset"] for r in per_image}):
        idx = [i for i, r in enumerate(per_image) if r["subset"] == subset]
        by_subset[subset] = {"n_images": len(idx),
                             "unreliable": sum(1 for i in idx if i in set(unreliable))}
    return {"n_images": n, "unreliable": len(unreliable),
            "unreliable_share": len(unreliable) / n if n else None,
            "by_reason": {k: reasons.get(k, 0) for k in REASONS},
            "by_subset": by_subset, "kept": group(kept), "abstained": group(unreliable)}


def _evaluate_test(model: ImageModel, test: Sequence[Item]) -> dict:
    """Metrics on the test images -- read once, after every choice has been made."""
    statuses: dict[Path, dict] = {}

    def predict(item: Item) -> np.ndarray:
        decoded, _ = _load(item)
        analysis, labels = analyze_with_labels(model, decoded, item.um_per_px)
        statuses[item.image] = {"status": analysis.status.value,
                                "reasons": [r.value for r in analysis.reasons]}
        return labels

    def shape_of(item: Item, labels: np.ndarray) -> dict[int, str]:
        ids = label_ids_by_area(labels)
        scored = classify(model, particles_from_labels(labels))
        return {ids[sp.particle.id - 1]: sp.shape for sp in scored}

    frac = model.settings.min_area_frac
    main = evaluate_split(test, predict, shape_of, min_area_frac=frac)
    status_list = [statuses[i.image] for i in test]

    def otsu(item: Item) -> np.ndarray:
        _, gray = _load(item)
        return otsu_baseline(gray, frac)

    baseline = evaluate_split(test, otsu, None, min_area_frac=frac)
    components, rules = _shape_on_components(model, test)
    metrics = {**_strip(main), "abstention": _abstention(main["per_image"], status_list),
               "shape_components": components, "shape_rules": rules}
    return {"metrics": metrics, "baseline_otsu": _strip(baseline)}


# ------------------------------------------------------------------ the whole training

def _by_split(items: Sequence[Item], split: str) -> list[Item]:
    return [i for i in items if i.split == split]


def _data_block(root: Path, items: Sequence[Item]) -> dict:
    by_subset: dict[str, dict[str, int]] = {}
    for it in items:
        by_subset.setdefault(it.subset, {"train": 0, "val": 0, "test": 0})[it.split] += 1
    groups: dict[str, dict] = {}
    for it in items:
        g = groups.setdefault(it.group, {"group": it.group, "split": it.split, "images": []})
        g["images"].append(it.image.name)
    return {
        "root": _display_path(root), "images": len(items),
        "by_subset": by_subset,
        "by_split": {s: len(_by_split(items, s)) for s in ("train", "val", "test")},
        "n_groups": len(groups), "groups": [groups[k] for k in sorted(groups)]}


def train(root: Path, *, items: Sequence[Item] | None = None) -> tuple[ImageModel, dict]:
    """Final model and manifest body (no date, no commit, no hash)."""
    root = Path(root)
    items = list(items) if items is not None else build_index(root)
    sides: dict[str, set[str]] = {}
    for it in items:
        sides.setdefault(it.group, set()).add(it.split)
    if any(len(s) > 1 for s in sides.values()):
        raise IndexMismatch("a group lies on two sides of the split")
    tr, va, te = (_by_split(items, s) for s in ("train", "val", "test"))

    holder: list = []
    forest_a = fit_forest(tr, estimator_out=holder)
    _check_numpy(holder[0], forest_a, va)
    shape_a = fit_shape(tr)
    settings, selection = choose_settings(forest_a, shape_a, va)

    final = tr + va
    holder = []
    forest = fit_forest(final, estimator_out=holder)
    _check_numpy(holder[0], forest, va)
    shape = fit_shape(final)
    lo, hi = _scale_range(final)
    settings = replace(settings, scale_min=lo / 2.0, scale_max=hi * 2.0)
    selection["scale_range_um_per_px"] = {"min": lo, "max": hi}

    model = ImageModel(IMAGE_MODEL_NAME, IMAGE_MODEL_VERSION, forest, shape, settings, {})
    result = _evaluate_test(model, te)
    g = result["metrics"]["global"]
    summary = {
        "test_images": len(te), "f1_objects": g["objects"]["f1"], "dice": g["dice"],
        "count_mae": g["count"]["mae"],
        "shape_balanced_accuracy": result["metrics"]["shape_components"]["balanced_accuracy"],
        "unreliable_share": result["metrics"]["abstention"]["unreliable_share"]}
    model = replace(model, meta={"metrics": summary, "trained_images": len(final)})
    body = {
        "model": {"name": IMAGE_MODEL_NAME, "version": IMAGE_MODEL_VERSION, "file": MODEL_FILE},
        "params": _params(),
        "data": _data_block(root, items),
        "selection": {**{k: v for k, v in selection.items()},
                      "settings": {k: getattr(settings, k) for k in
                                   ("pixel_threshold", "min_area_frac", "shape_min_score",
                                    "max_foreground", "scale_min", "scale_max")}},
        "metrics": result["metrics"],
        "baseline_otsu": result["baseline_otsu"],
    }
    return model, body


# ------------------------------------------------------------------ reports

def _pct(v: float | None) -> str:
    return "n/d" if v is None else f"{100 * v:.1f} %".replace(".", ",")


def _num(v: float | None, digits: int = 2) -> str:
    return "n/d" if v is None else f"{v:.{digits}f}".replace(".", ",")


def _fr(v: float) -> str:
    return f"{v:g}".replace(".", ",")


def _row(name: str, b: Mapping) -> str:
    o, c = b["objects"], b["count"]
    return (f"| {name} | {b['n_images']} | {_num(b['dice'], 3)} | {_num(o['f1'], 2)} "
            f"| {_num(o['precision'], 2)} | {_num(o['recall'], 2)} | {c['n']} "
            f"| {_num(c['mae'])} | {_num(c['bias'])} | {_pct(c['exact'])} "
            f"| {_pct(c['within_20pct'])} |")


_HEAD = ("| Ensemble | Images | Dice | F1 objets | Précision | Rappel | Images comptées "
         "| Erreur de comptage | Biais | Comptage exact | À ±20 % |")
_SEP = "|---|---|---|---|---|---|---|---|---|---|---|"


def _confusion_table(conf: Mapping) -> list[str]:
    preds = sorted({p for row in conf.values() for p in row})
    lines = ["| Vérité \\ Prédit | " + " | ".join(preds) + " |",
             "|---" * (len(preds) + 1) + "|"]
    for t, row in conf.items():
        lines.append(f"| {t} | " + " | ".join(str(row.get(p, 0)) for p in preds) + " |")
    return lines


def render_card_metrics(manifest: Mapping) -> str:
    """Markdown metrics block for the model card (content between the markers)."""
    m, base, sel = manifest["metrics"], manifest["baseline_otsu"], manifest["selection"]
    s = sel["settings"]
    L = ["**Réglages choisis sur la validation** : "
         f"seuil de pixel {_fr(s['pixel_threshold'])}, taille minimale "
         f"{_fr(100 * s['min_area_frac'])} % de l'image, score de forme minimal "
         f"{_fr(s['shape_min_score'])}, part segmentée maximale {_fr(100 * s['max_foreground'])} %, "
         f"échelle admise de {_fr(round(s['scale_min'], 3))} à {_fr(round(s['scale_max'], 2))} "
         "µm par pixel de l'image d'analyse.", "",
         f"**Test** ({m['n_images']} images, lues une seule fois après tous les choix) : "
         "modèle servi et référence « seuil d'Otsu » à résolution et taille minimale égales "
         "(la référence est un seul traitement fixe, sans la grille de 16 réglages du "
         "protocole de conception).", "",
         _HEAD, _SEP, _row("modèle, global", m["global"]),
         _row("référence Otsu, global", base["global"])]
    for name, b in m["by_subset"].items():
        L.append(_row(f"modèle, {name}", b))
    for name, b in base["by_subset"].items():
        L.append(_row(f"Otsu, {name}", b))
    z = m["global"]["size"]
    L += ["", "**Tailles** (objets appariés, IoU ≥ 0,5) : "
          f"{z['n_pairs']} paires ; Feret maximal, erreur relative médiane "
          f"{_pct(z['feret_rel_err_median'])}, 90e centile {_pct(z['feret_rel_err_p90'])}, "
          f"biais {_pct(z['feret_bias'])} ; aire, erreur relative médiane "
          f"{_pct(z['area_rel_err_median'])}, 90e centile {_pct(z['area_rel_err_p90'])}, "
          f"biais {_pct(z['area_bias'])}.", ""]
    sc, sr = m["shape_components"], m["shape_rules"]
    L += ["**Forme** (composantes du masque de référence du test, pour isoler le classifieur) : "
          f"classifieur servi, exactitude {_pct(sc['accuracy'])}, exactitude équilibrée "
          f"{_pct(sc['balanced_accuracy'])} ({sc['n']} composantes) ; règles de référence "
          f"(allongement ≥ 3), exactitude {_pct(sr['accuracy'])}, exactitude équilibrée "
          f"{_pct(sr['balanced_accuracy'])}.", "",
          "| Forme | Rappel du classifieur | Rappel des règles |", "|---|---|---|"]
    for k in sorted(sc["recall"]):
        L.append(f"| {k} | {_pct(sc['recall'][k])} | {_pct(sr['recall'].get(k))} |")
    L += ["", "Matrice de confusion du classifieur (composantes du masque) :", ""]
    L += _confusion_table(sc["confusion"])
    shp = m["global"]["shape"]
    if shp:
        L += ["", "Matrice de confusion sur les particules proposées et appariées "
              f"({shp['n']} particules ; exactitude {_pct(shp['accuracy'])}, équilibrée "
              f"{_pct(shp['balanced_accuracy'])}) :", ""]
        L += _confusion_table(shp["confusion"])
    a = m["abstention"]
    L += ["", f"**Abstention** : {a['unreliable']} images « non fiable » sur {a['n_images']} "
          f"({_pct(a['unreliable_share'])}).", "",
          "| Raison | Images |", "|---|---|"]
    L += [f"| {k} | {a['by_reason'].get(k, 0)} |" for k in REASONS]
    k_, ab = a["kept"], a["abstained"]
    L += ["", f"Images gardées : {k_['n_images']}, F1 objets {_num(k_['f1'])}, erreur de comptage "
          f"{_num(k_['count_mae'])} ({k_['n_counted']} comptées). Images abstenues : "
          f"{ab['n_images']}, F1 objets {_num(ab['f1'])}, erreur de comptage "
          f"{_num(ab['count_mae'])} ({ab['n_counted']} comptées).", ""]
    return "\n".join(L)


# ------------------------------------------------------------------ command

def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _atomic_write(path: Path, data: bytes) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _json_bytes(obj: Mapping) -> bytes:
    return (json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def _display_path(path: Path) -> str:
    p = Path(path).resolve()
    try:
        return p.relative_to(Path.cwd().resolve()).as_posix()
    except ValueError:
        return Path(path).name


def _data_list(root: Path, items: Sequence[Item]) -> tuple[bytes, int]:
    """``sha256sum``-style list of every image, mask, counts file and matching TIFF."""
    files: set[Path] = set()
    for it in items:
        files.update({it.image, it.label})
        if it.tiff is not None:
            files.add(it.tiff)
        files.update(it.image.parent.parent.glob("counts_*.txt"))
    lines = sorted(f"{_sha256_file(f)}  {f.relative_to(root).as_posix()}" for f in files)
    return ("\n".join(lines) + "\n").encode("utf-8"), len(lines)


def run_training(*, dataset: Path, models_dir: Path, manifest: Path, data_list: Path, lock: Path,
                 card: Path | None, check: bool = False,
                 expected_images: int = EXPECTED_IMAGES) -> int:
    """Train, evaluate, write. Exit codes: 0, 3 index, 4 hash (--check), 5 settings, 6 numpy."""
    dataset = Path(dataset)
    items = build_index(dataset)
    sides: dict[str, set[str]] = {}
    for it in items:
        sides.setdefault(it.group, set()).add(it.split)
    if len(items) != expected_images or any(len(s) > 1 for s in sides.values()):
        print(f"index mismatch: {len(items)} images, {expected_images} expected", file=sys.stderr)
        return 3
    try:
        model, body = train(dataset, items=items)
    except NoSettings as exc:
        print(f"no settings: {exc}", file=sys.stderr)
        return 5
    except NumpyMismatch as exc:
        print(str(exc), file=sys.stderr)
        return 6
    except IndexMismatch as exc:
        print(str(exc), file=sys.stderr)
        return 3

    data = archive_bytes(model_to_arrays(model))
    if len(data) > MAX_ARCHIVE_BYTES:
        raise RuntimeError(f"model archive is {len(data)} bytes, over the 50 MB limit")
    sha = hashlib.sha256(data).hexdigest()

    if check:
        recorded = json.loads(Path(manifest).read_text(encoding="utf-8"))["model"]["sha256"]
        return 0 if recorded == sha else 4

    # Everything is computed before the first write: a bad card must not leave a partial output.
    card_text = None
    if card is not None:
        raw = Path(card).read_bytes().decode("utf-8")
        card_text = replace_metrics_block(raw, render_card_metrics(body)).encode("utf-8")
    list_bytes, n_files = _data_list(dataset, items)

    body["model"].update({"sha256": sha, "size_bytes": len(data)})
    body["trained_at"] = date.today().isoformat()
    body["code"] = {
        "git_commit": _git_commit(), "git_dirty": _git_dirty(), "numpy": np.__version__,
        "scipy": scipy.__version__, "scikit-learn": sklearn.__version__,
        "scikit-image": skimage.__version__, "Pillow": PIL.__version__,
        "python": platform.python_version()}
    body["data"]["data_list"] = {"path": _display_path(data_list),
                                 "sha256": hashlib.sha256(list_bytes).hexdigest(),
                                 "files": n_files}
    lock_obj = {"name": IMAGE_MODEL_NAME, "version": IMAGE_MODEL_VERSION, "file": MODEL_FILE,
                "sha256": sha}

    _atomic_write(Path(models_dir) / MODEL_FILE, data)
    _atomic_write(Path(data_list), list_bytes)
    _atomic_write(Path(manifest), _json_bytes(body))
    _atomic_write(Path(lock), _json_bytes(lock_obj))
    if card_text is not None:
        _atomic_write(Path(card), card_text)
    return 0
