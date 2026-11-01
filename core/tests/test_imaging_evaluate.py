"""Common evaluator: instance matching, ground-truth instances, split metrics."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from microtrace_core.imaging.dataset import Item
from microtrace_core.imaging.evaluate import (
    evaluate_split,
    gt_instances,
    labels_from_polygons,
    match_instances,
)

from imaging_fixtures import png, rect_image


def _sq(h, w, top, left, size, label=1):
    a = np.zeros((h, w), np.int32)
    a[top:top + size, left:left + size] = label
    return a


def test_match_instances():
    gt = _sq(200, 200, 50, 50, 100)
    near = _sq(200, 200, 60, 50, 100)          # shifted by 10 % of the side
    (pid, gid, iou), = match_instances(near, gt)
    assert (pid, gid) == (1, 1) and iou == pytest.approx(0.818, abs=0.01)
    assert match_instances(_sq(200, 200, 110, 50, 100), gt) == []     # shifted by 60 %

    two = np.zeros((200, 400), np.int32)
    two[50:150, 20:120] = 1
    two[50:150, 160:260] = 2
    big = np.zeros_like(two)
    big[50:150, 20:260] = 1                      # one prediction covering both true objects
    assert len(match_instances(big, two, iou_min=0.3)) == 1
    assert match_instances(np.zeros_like(two), two) == []


def test_match_is_greedy_by_iou_and_one_to_one():
    gt = np.zeros((100, 300), np.int32)
    gt[10:60, 10:60] = 1
    gt[10:60, 100:150] = 2
    pred = np.zeros_like(gt)
    pred[10:60, 12:62] = 1       # IoU with gt 1 = 0.92
    pred[10:60, 100:150] = 2     # IoU with gt 2 = 1.0
    pred[10:60, 200:250] = 3     # no match
    pairs = sorted(match_instances(pred, gt))
    assert [(p, g) for p, g, _ in pairs] == [(1, 1), (2, 2)]


def test_gt_instances_filters_small_components_and_relabels():
    mask = np.zeros((200, 200), bool)
    mask[10:50, 10:50] = True      # 1600 px
    mask[100:104, 100:104] = True  # 16 px
    mask[150:190, 150:190] = True
    lab = gt_instances(mask, 0.01)  # minimum 400 px
    assert lab.max() == 2 and (lab > 0).sum() == 3200
    assert gt_instances(mask, 0.0).max() == 3
    assert gt_instances(np.zeros((10, 10), bool), 0.0).max() == 0


def test_labels_from_polygons():
    poly = [[10, 10], [60, 10], [60, 60], [10, 60]]
    lab = labels_from_polygons([poly, [[100, 100], [140, 100], [120, 140]]], (200, 200))
    assert lab.max() == 2 and lab[30, 30] == 1 and lab[120, 120] == 2 and lab[0, 0] == 0
    assert labels_from_polygons([], (50, 50)).max() == 0


def _item(tmp_path: Path, name, subset, shape, mask: np.ndarray, count):
    img = tmp_path / f"{name}.png"
    lab = tmp_path / f"{name}_label.png"
    img.write_bytes(png(np.zeros(mask.shape, np.uint8)))
    lab.write_bytes(png((mask * 255).astype(np.uint8)))
    return Item(subset, shape, img, lab, count, None, None, name, "test")


def test_evaluate_split_perfect_and_imperfect(tmp_path):
    m1 = np.zeros((200, 300), bool)
    m1[40:100, 40:100] = True
    m1[120:180, 150:250] = True
    m2 = np.zeros((200, 300), bool)
    m2[30:130, 100:160] = True
    items = [_item(tmp_path, "a", "bead", "bille", m1, 2),
             _item(tmp_path, "b", "fibre_1", "fibre", m2, 1)]
    truth = {items[0].image: gt_instances(m1, 0.001), items[1].image: gt_instances(m2, 0.001)}

    perfect = evaluate_split(items, lambda it: truth[it.image], None, min_area_frac=0.001)
    g = perfect["global"]
    assert g["objects"]["f1"] == pytest.approx(1.0) and g["dice"] == pytest.approx(1.0)
    assert g["count"]["mae"] == 0.0 and g["count"]["exact"] == 1.0 and g["count"]["n"] == 2
    assert g["size"]["feret_rel_err_median"] == pytest.approx(0.0, abs=1e-9)
    assert set(perfect["by_subset"]) == {"bead", "fibre_1"}
    assert len(perfect["per_image"]) == 2 and perfect["n_images"] == 2

    def predict(it):  # image a: only the first object; image b: nothing but a spurious blob
        out = np.zeros_like(truth[it.image])
        if it.subset == "bead":
            out[40:100, 40:100] = 1
        else:
            out[0:20, 0:20] = 1
        return out

    bad = evaluate_split(items, predict, None, min_area_frac=0.001)["global"]
    o = bad["objects"]
    assert (o["tp"], o["fp"], o["fn"]) == (1, 1, 2)
    assert o["precision"] == pytest.approx(0.5) and o["recall"] == pytest.approx(1 / 3)
    assert bad["count"]["mae"] == pytest.approx((1 + 0) / 2) and bad["count"]["bias"] == pytest.approx(
        (-1 + 0) / 2)
    assert bad["count"]["within_20pct"] == pytest.approx(1.0)  # off by one counts as close


def test_evaluate_split_shapes_and_unmatched_counts(tmp_path):
    m = np.zeros((200, 300), bool)
    m[40:100, 40:100] = True
    m[120:180, 150:250] = True
    items = [_item(tmp_path, "a", "bead", "bille", m, None)]
    truth = gt_instances(m, 0.001)
    res = evaluate_split(items, lambda it: truth, lambda it, lab: {1: "bille", 2: "fragment"},
                         min_area_frac=0.001)
    shape = res["global"]["shape"]
    assert shape["confusion"]["bille"]["bille"] + shape["confusion"]["bille"]["fragment"] == 2
    assert shape["accuracy"] == pytest.approx(0.5)
    assert shape["balanced_accuracy"] == pytest.approx(0.5)
    assert res["global"]["count"]["n"] == 0 and res["global"]["count"]["mae"] is None


def test_gt_helper_handles_thin_rectangle():
    img = rect_image(100, 300, 40, 10, 6, 250)
    assert gt_instances(img > 0, 0.001).max() == 1
