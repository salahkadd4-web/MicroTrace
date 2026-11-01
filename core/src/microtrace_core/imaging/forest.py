"""A random forest stored as flat arrays and evaluated with numpy alone."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Forest:
    feature: np.ndarray    # int16; -1 on a leaf
    threshold: np.ndarray  # float32
    left: np.ndarray       # int32 (global node index; a leaf points at itself)
    right: np.ndarray      # int32
    value: np.ndarray      # float32; probability "particle" at a leaf
    roots: np.ndarray      # int32; first node of each tree
    max_depth: int


def _floor32(threshold: np.ndarray) -> np.ndarray:
    """Largest float32 not above each float64 threshold: ``x <= t32`` equals ``x <= t64``
    for every float32 ``x``, which is how scikit-learn compares."""
    t32 = threshold.astype(np.float32)
    above = t32.astype(np.float64) > threshold
    t32[above] = np.nextafter(t32[above], np.float32(-np.inf))
    return t32


def forest_from_sklearn(rf) -> Forest:
    """Flatten a fitted two-class scikit-learn forest (training time only)."""
    feats, thrs, lefts, rights, vals, roots = [], [], [], [], [], []
    offset = 0
    depth = 0
    for est in rf.estimators_:
        t = est.tree_
        n = t.node_count
        leaf = t.children_left < 0
        idx = np.arange(n, dtype=np.int64) + offset
        feats.append(np.where(leaf, -1, t.feature).astype(np.int16))
        thrs.append(_floor32(np.where(leaf, 0.0, t.threshold)))
        lefts.append(np.where(leaf, idx, t.children_left + offset).astype(np.int32))
        rights.append(np.where(leaf, idx, t.children_right + offset).astype(np.int32))
        counts = t.value[:, 0, :]
        vals.append((counts[:, 1] / counts.sum(axis=1)).astype(np.float32))
        roots.append(offset)
        depth = max(depth, int(t.max_depth))
        offset += n
    return Forest(
        feature=np.concatenate(feats), threshold=np.concatenate(thrs),
        left=np.concatenate(lefts), right=np.concatenate(rights), value=np.concatenate(vals),
        roots=np.asarray(roots, dtype=np.int32), max_depth=depth)


N_GROUPS = 2  # trees are split in two fixed groups, evaluated in two threads, summed in order


def forest_proba(f: Forest, X: np.ndarray) -> np.ndarray:
    """Probability of the positive class per row: mean of the leaf values over the trees.

    Each tree is walked by partitioning the row indices at every split (so a row is only
    touched along its own path); numpy releases the GIL, so two threads share the trees.
    """
    X = np.asarray(X, dtype=np.float32)
    n = X.shape[0]
    n_trees = len(f.roots)
    if n == 0 or n_trees == 0:
        return np.zeros(n, dtype=np.float32)
    cols = np.ascontiguousarray(X.T)  # one contiguous column per feature
    feature = f.feature.tolist()
    threshold = f.threshold.tolist()  # float32 values, exact as Python floats
    left, right = f.left.tolist(), f.right.tolist()
    value = f.value.astype(np.float64).tolist()
    roots = [int(r) for r in f.roots]

    def run(group: list[int]) -> np.ndarray:
        total = np.zeros(n, dtype=np.float64)

        def walk(node: int, idx: np.ndarray) -> None:
            feat = feature[node]
            if feat < 0:
                total[idx] += value[node]
                return
            go_left = cols[feat][idx] <= threshold[node]
            to_left = idx[go_left]
            if to_left.size:
                walk(left[node], to_left)
            np.logical_not(go_left, out=go_left)
            to_right = idx[go_left]
            if to_right.size:
                walk(right[node], to_right)

        everyone = np.arange(n, dtype=np.int32)
        for root in group:
            walk(root, everyone)
        return total

    groups = [roots[i::N_GROUPS] for i in range(N_GROUPS)]
    with ThreadPoolExecutor(N_GROUPS) as pool:
        totals = list(pool.map(run, groups))
    total = totals[0]
    for other in totals[1:]:
        total = total + other
    return (total / n_trees).astype(np.float32)
