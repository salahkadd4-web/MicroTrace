"""The common evaluator: the same code scores the served model, the Otsu reference and, later,
polygon predictions from other models (``python -m microtrace_core image-eval``).

Instances of the ground truth are the connected components of the binary mask (the masks of
``dataset3`` carry no instance identity).
"""
from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Sequence

import numpy as np
from skimage import draw, measure

from microtrace_core.imaging.dataset import Item, load_mask
from microtrace_core.imaging.geometry import particles_from_labels


def match_instances(pred: np.ndarray, gt: np.ndarray, iou_min: float = 0.5
                    ) -> list[tuple[int, int, float]]:
    """Greedy one-to-one matching by decreasing IoU: ``(pred id, gt id, IoU)`` for IoU >= iou_min."""
    pred = np.asarray(pred, dtype=np.int64)
    gt = np.asarray(gt, dtype=np.int64)
    both = (pred > 0) & (gt > 0)
    if not both.any():
        return []
    n_gt = int(gt.max()) + 1
    pair = pred[both] * n_gt + gt[both]
    codes, inter = np.unique(pair, return_counts=True)
    area_p = np.bincount(pred.ravel())
    area_g = np.bincount(gt.ravel())
    cands = []
    for code, n in zip(codes, inter, strict=True):
        p, g = divmod(int(code), n_gt)
        iou = n / (area_p[p] + area_g[g] - n)
        if iou >= iou_min:
            cands.append((-iou, p, g))
    cands.sort()
    used_p: set[int] = set()
    used_g: set[int] = set()
    out = []
    for neg, p, g in cands:
        if p in used_p or g in used_g:
            continue
        used_p.add(p)
        used_g.add(g)
        out.append((p, g, -neg))
    return out


def gt_instances(mask: np.ndarray, min_area_frac: float) -> np.ndarray:
    """Connected components (8-connectivity) of ``mask`` of at least ``min_area_frac`` of the
    image, relabelled 1..n."""
    mask = np.asarray(mask, dtype=bool)
    lab = measure.label(mask, connectivity=2).astype(np.int32)
    if lab.max() == 0:
        return lab
    counts = np.bincount(lab.ravel())
    keep = counts >= max(1.0, min_area_frac * mask.size)
    keep[0] = False
    new = np.cumsum(keep).astype(np.int32)
    new[~keep] = 0
    return new[lab]


def labels_from_polygons(polygons: Sequence[Sequence[Sequence[float]]], shape: tuple[int, int]
                         ) -> np.ndarray:
    """Rasterise polygons (lists of ``[x, y]``) into a label image, ids 1..n in input order."""
    lab = np.zeros(shape, dtype=np.int32)
    for k, poly in enumerate(polygons, start=1):
        pts = np.asarray(poly, dtype=np.float64)
        if len(pts) < 3:
            continue
        rr, cc = draw.polygon(pts[:, 1], pts[:, 0], shape)
        lab[rr, cc] = k
    return lab


# ------------------------------------------------------------------ metrics

def _div(a: float, b: float) -> float | None:
    return None if b == 0 else float(a / b)


def _quantile(v: Sequence[float], q: float) -> float | None:
    return float(np.quantile(np.asarray(v, dtype=np.float64), q)) if len(v) else None


def _objects(rows: Sequence[dict]) -> dict:
    tp = sum(r["tp"] for r in rows)
    fp = sum(r["fp"] for r in rows)
    fn = sum(r["fn"] for r in rows)
    p, r = _div(tp, tp + fp), _div(tp, tp + fn)
    f1 = None if p is None or r is None or p + r == 0 else 2 * p * r / (p + r)
    return {"tp": tp, "fp": fp, "fn": fn, "precision": p, "recall": r, "f1": f1}


def _count(rows: Sequence[dict]) -> dict:
    d = [(r["pred_count"], r["true_count"]) for r in rows if r["true_count"] is not None]
    if not d:
        return {"n": 0, "mae": None, "bias": None, "exact": None, "within_20pct": None}
    err = np.array([p - t for p, t in d], dtype=np.float64)
    ok20 = [abs(p - t) <= max(1.0, 0.2 * t) for p, t in d]
    return {"n": len(d), "mae": float(np.abs(err).mean()), "bias": float(err.mean()),
            "exact": float((err == 0).mean()), "within_20pct": float(np.mean(ok20))}


def _size(rows: Sequence[dict]) -> dict:
    feret = [e for r in rows for e in r["feret_errors"]]
    area = [e for r in rows for e in r["area_errors"]]

    def summary(v, key):
        a = np.abs(np.asarray(v, dtype=np.float64)) if len(v) else np.zeros(0)
        return {f"{key}_rel_err_median": float(np.median(a)) if len(a) else None,
                f"{key}_rel_err_p90": float(np.quantile(a, 0.9)) if len(a) else None,
                f"{key}_bias": float(np.mean(v)) if len(v) else None}

    return {"n_pairs": len(feret), **summary(feret, "feret"), **summary(area, "area")}


def _shape(confusion: Counter) -> dict | None:
    if not confusion:
        return None
    truths = sorted({t for t, _ in confusion})
    preds = sorted({p for _, p in confusion} | set(truths))
    matrix = {t: {p: confusion[(t, p)] for p in preds} for t in truths}
    total = sum(confusion.values())
    correct = sum(confusion[(t, t)] for t in truths)
    recalls = {t: _div(confusion[(t, t)], sum(matrix[t].values())) for t in truths}
    vals = [v for v in recalls.values() if v is not None]
    return {"n": total, "confusion": matrix, "accuracy": _div(correct, total),
            "recall": recalls, "balanced_accuracy": float(np.mean(vals)) if vals else None}


def _block(rows: Sequence[dict], confusion: Counter) -> dict:
    dice = [r["dice"] for r in rows]
    return {"n_images": len(rows), "dice": float(np.mean(dice)) if dice else None,
            "objects": _objects(rows), "count": _count(rows), "size": _size(rows),
            "shape": _shape(confusion)}


def _dice(pred_mask: np.ndarray, gt_mask: np.ndarray) -> float:
    total = int(pred_mask.sum()) + int(gt_mask.sum())
    return 1.0 if total == 0 else float(2 * int((pred_mask & gt_mask).sum()) / total)


def evaluate_split(items: Sequence[Item], predict: Callable[[Item], np.ndarray],
                   shape_of: Callable[[Item, np.ndarray], dict[int, str]] | None, *,
                   min_area_frac: float, iou_min: float = 0.5) -> dict:
    """Score ``predict`` (item -> label image at the analysis size) on ``items``.

    ``shape_of(item, labels)`` maps each predicted label id to a shape name (for the confusion of
    matched objects; the truth is the shape of the item's folder). ``min_area_frac`` is the
    minimum size of a ground-truth component, the same as the one used by the model.
    """
    rows: list[dict] = []
    confusions: dict[str, Counter] = {}
    overall = Counter()
    for item in items:
        pred = np.asarray(predict(item))
        mask = load_mask(item.label, pred.shape)
        gt = gt_instances(mask, min_area_frac)
        pairs = match_instances(pred, gt, iou_min)
        n_pred = int(len(np.unique(pred[pred > 0])))
        n_gt = int(gt.max())
        feret_err, area_err = [], []
        if pairs:
            pp = {p.id: p for p in particles_from_labels(pred)}
            # particles_from_labels renumbers by area: map label ids through the pixel they cover
            lab_to_part = _label_to_particle(pred, pp)
            gp = {p.id: p for p in particles_from_labels(gt)}
            g_to_part = _label_to_particle(gt, gp)
            for p_lab, g_lab, _ in pairs:
                a, b = lab_to_part[p_lab], g_to_part[g_lab]
                feret_err.append((a.feret_max_px - b.feret_max_px) / b.feret_max_px)
                area_err.append((a.area_px - b.area_px) / b.area_px)
        conf = Counter()
        if shape_of is not None and pairs:
            names = shape_of(item, pred)
            for p_lab, _g, _ in pairs:
                if p_lab in names:
                    conf[(item.shape, names[p_lab])] += 1
        confusions.setdefault(item.subset, Counter()).update(conf)
        overall.update(conf)
        rows.append({
            "subset": item.subset, "dice": _dice(pred > 0, mask), "tp": len(pairs),
            "fp": n_pred - len(pairs), "fn": n_gt - len(pairs), "pred_count": n_pred,
            "true_count": item.count, "gt_count": n_gt,
            "feret_errors": feret_err, "area_errors": area_err})
    by_subset = {s: _block([r for r in rows if r["subset"] == s], confusions.get(s, Counter()))
                 for s in sorted({r["subset"] for r in rows})}
    per_image = [{k: r[k] for k in ("subset", "dice", "tp", "fp", "fn", "pred_count",
                                    "true_count", "gt_count")} for r in rows]
    return {"n_images": len(rows), "global": _block(rows, overall), "by_subset": by_subset,
            "per_image": per_image}


def label_ids_by_area(labels: np.ndarray) -> list[int]:
    """Label ids in the order ``particles_from_labels`` numbers them (particle id k is item k-1)."""
    counts = np.bincount(np.asarray(labels).ravel().astype(np.int64))
    ids = np.nonzero(counts[1:] > 0)[0] + 1
    return [int(i) for i in ids[np.lexsort((ids, -counts[ids]))]]


def _label_to_particle(labels: np.ndarray, by_id: dict) -> dict:
    """Map each original label id to its ``Particle`` (ids were renumbered by area)."""
    return {lab: by_id[k] for k, lab in enumerate(label_ids_by_area(labels), start=1)}


def evaluate_polygons(root, items: Sequence[Item], predictions: dict, *, min_area_frac: float
                      ) -> dict:
    """Score polygon predictions from another model with the same evaluator.

    ``predictions`` maps an image path relative to the dataset root (posix) to a list of polygons
    (``[[x, y], ...]``) in the pixel coordinates of that PNG. Images without an entry count as
    "nothing found".
    """
    from pathlib import Path

    from PIL import Image

    from microtrace_core.imaging.model import analysis_size

    root = Path(root)

    def predict(item: Item) -> np.ndarray:
        with Image.open(item.image) as im:
            w, h = im.size
        aw, ah = analysis_size(h, w)
        polys = predictions.get(item.image.relative_to(root).as_posix(), [])
        scaled = [[[x * aw / w, y * ah / h] for x, y in poly] for poly in polys]
        return labels_from_polygons(scaled, (ah, aw))

    result = evaluate_split(items, predict, None, min_area_frac=min_area_frac)
    result["n_without_prediction"] = sum(
        1 for it in items if it.image.relative_to(root).as_posix() not in predictions)
    return {k: v for k, v in result.items() if k != "per_image"}
