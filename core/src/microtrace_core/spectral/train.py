"""Training and leave-one-library-out (LOLO) evaluation of the spectral model s1.

The only module that imports scikit-learn (extra ``core[train]``).
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import scipy
import sklearn
from sklearn.decomposition import PCA
from sklearn.svm import SVC

from microtrace_core.catalog import _git_commit, _git_dirty, grid_matrix, load_catalog
from microtrace_core.polymers import OTHER as POLYMER_OTHER
from microtrace_core.polymers import UNKNOWN as POLYMER_UNKNOWN
from microtrace_core.preprocess import (
    DIAGNOSTIC_WINDOWS,
    GRIDS,
    PREPROCESS_VERSION,
    diagnostic_coverage,
    preprocess,
)
from microtrace_core.spectral import SEED, SPECTRAL_MODEL_NAME, SPECTRAL_MODEL_VERSION
from microtrace_core.spectral import thresholds as th
from microtrace_core.spectral.archive import archive_bytes, model_to_arrays
from microtrace_core.spectral.matching import CorrelationMatcher, correlation_matrix
from microtrace_core.spectral.model import (
    MIN_COVERAGE,
    MIN_OVERLAP,
    N_CANDIDATES,
    N_REFERENCES,
    OTHER,
    PCA_COMPONENTS,
    PLOT_STRIDE,
    TECHNIQUE_MISMATCH_MARGIN,
    Abstention,
    SpectralModel,
    SvmParams,
    TechniqueModel,
    guard_eligible,
    other_technique_spectrum,
    pca_transform,
    polymer_scores,
    ranked_polymers,
    svm_predict,
    technique_mismatch,
    window_mask,
)
from microtrace_core.spectral.thresholds import (
    LoloPrediction,
    NoThresholds,
    Status,
    Thresholds,
    choose_thresholds,
    round12,
    status_of,
)
from microtrace_core.spectrum import Spectrum, Technique

TECHNIQUES: tuple[Technique, ...] = ("ftir_atr", "raman")
MODEL_FILE = "c5-spectral-s1.npz"
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
CHUNK = 256
BEGIN_MARKER = "<!-- BEGIN:metrics -->"
END_MARKER = "<!-- END:metrics -->"
_PLACEHOLDER = Thresholds(0.0, 0.0, 0.0)


class BaselineMismatch(RuntimeError):
    """The baseline figures could not be reproduced within tolerance."""


# ----------------------------------------------------------------- data selection

def training_frame(df: pd.DataFrame, technique: Technique) -> pd.DataFrame:
    """Known polymer and diagnostic coverage >= MIN_COVERAGE, for one technique."""
    keep = ((df["technique"] == technique)
            & ~df["polymer"].isin({POLYMER_UNKNOWN, POLYMER_OTHER})
            & (df["diagnostic_coverage"] >= MIN_COVERAGE))
    return df[keep].reset_index(drop=True)


def _exclusions(df: pd.DataFrame, technique: Technique) -> dict[str, int]:
    d = df[df["technique"] == technique]
    bad = d["polymer"].isin({POLYMER_UNKNOWN, POLYMER_OTHER})
    return {
        "UNKNOWN": int((d["polymer"] == POLYMER_UNKNOWN).sum()),
        "OTHER": int((d["polymer"] == POLYMER_OTHER).sum()),
        "low_coverage": int((~bad & ~(d["diagnostic_coverage"] >= MIN_COVERAGE)).sum()),
    }


# ----------------------------------------------------------------- baseline gate

def baseline_correlation(df: pd.DataFrame, technique: Technique) -> float:
    """Whole-grid correlation@0 accuracy under leave-one-library-out (in-library queries)."""
    d = training_frame(df, technique)
    Y = grid_matrix(d)
    y = d["polymer"].to_numpy(dtype=object)
    ids = d["spectrum_id"].to_numpy(dtype=object)
    src = d["source"].to_numpy(dtype=object)
    hits = total = 0
    for held in sorted(set(src)):
        te = src == held
        tr = ~te
        if not tr.any():
            continue
        res = CorrelationMatcher().fit(Y[tr], y[tr], ids[tr]).predict(Y[te])
        inside = np.isin(y[te], list(set(y[tr])))
        hits += int((res.labels[inside] == y[te][inside]).sum())
        total += int(inside.sum())
    return hits / total


def reproduce_baseline(df: pd.DataFrame, baseline: Mapping, tolerance: float = 0.005) -> dict:
    """Recompute the baseline LOLO accuracy; raise BaselineMismatch beyond ``tolerance``."""
    out: dict[str, dict[str, float]] = {}
    for t in TECHNIQUES:
        if t not in baseline.get("techniques", {}) or training_frame(df, t).empty:
            continue
        expected = float(
            baseline["techniques"][t]["protocols"]["loso"]["pooled"]["correlation@0"]["accuracy"])
        measured = baseline_correlation(df, t)
        out[t] = {"expected": expected, "measured": measured, "delta": measured - expected}
    bad = [t for t, r in out.items() if abs(r["delta"]) > tolerance]
    if bad:
        raise BaselineMismatch(
            "baseline not reproduced: "
            + "; ".join(f"{t} expected {out[t]['expected']:.6f}, measured {out[t]['measured']:.6f}"
                        for t in bad))
    return out


# ----------------------------------------------------------------- fitting

def fit_technique(df_t: pd.DataFrame, technique: Technique, thresholds: Thresholds | None,
                  *, verify: bool = False) -> TechniqueModel:
    """References, PCA and one-vs-one RBF SVM on the diagnostic window."""
    Y = grid_matrix(df_t)
    refs = Y[:, window_mask(technique)].astype(np.float32)
    plot = Y[:, ::PLOT_STRIDE].astype(np.float16)
    labels = df_t["polymer"].to_numpy(dtype=str)
    X = np.nan_to_num(refs.astype(np.float64))
    n_comp = max(1, min(PCA_COMPONENTS, len(X) - 1, X.shape[1]))
    pca = PCA(n_components=n_comp, svd_solver="full").fit(X)
    mean = np.asarray(pca.mean_, dtype=np.float64)
    comps = np.asarray(pca.components_, dtype=np.float64)
    Z = pca_transform(mean, comps, refs)

    classes = np.unique(labels)
    var = float(Z.var())
    gamma = 1.0 / (Z.shape[1] * var) if var > 0 else 1.0  # gamma="scale"
    if len(classes) < 2:
        svm = SvmParams(classes=classes, support_vectors=np.zeros((0, n_comp)),
                        dual_coef=np.zeros((0, 0)), intercept=np.zeros(0),
                        n_support=np.zeros(1, dtype=np.int64), gamma=gamma)
    else:
        clf = SVC(kernel="rbf", C=1.0, gamma=gamma, class_weight="balanced",
                  random_state=SEED).fit(Z, labels)
        dual, intercept = clf.dual_coef_, clf.intercept_
        if len(clf.classes_) == 2:  # sklearn flips the sign of the binary case
            dual, intercept = -dual, -intercept
        svm = SvmParams(classes=np.asarray(clf.classes_, dtype=str),
                        support_vectors=np.asarray(clf.support_vectors_, dtype=np.float64),
                        dual_coef=np.asarray(dual, dtype=np.float64),
                        intercept=np.asarray(intercept, dtype=np.float64),
                        n_support=np.asarray(clf.n_support_, dtype=np.int64), gamma=gamma)
        if verify and not np.array_equal(svm_predict(svm, Z), clf.predict(Z)):
            raise RuntimeError(
                f"numpy SVM differs from scikit-learn on the {technique} training set")
    return TechniqueModel(
        technique=technique, refs=refs, plot=plot,
        plot_x=GRIDS[technique][::PLOT_STRIDE].astype(np.float32),
        ids=df_t["spectrum_id"].to_numpy(dtype=str), labels=labels,
        sources=df_t["source"].to_numpy(dtype=str), pca_mean=mean, pca_components=comps,
        svm=svm, thresholds=thresholds if thresholds is not None else _PLACEHOLDER)


# ----------------------------------------------------------------- LOLO

def guard_reference(other: pd.DataFrame, held: str) -> pd.DataFrame:
    """The other technique's references for the guard, without the held-out library."""
    return other[other["source"] != held].reset_index(drop=True)


def _eligible(row) -> bool:
    return guard_eligible(row["x_unit"], row["y_unit"])


def _grid_as_other(row, technique: Technique, cache: dict[str, np.ndarray]) -> np.ndarray:
    """A catalogue row (cm-1, not transmittance) preprocessed as the other technique."""
    key = f"{technique}|{row['spectrum_id']}"
    if key not in cache:
        s = other_technique_spectrum(technique, np.asarray(row["x_raw"]), np.asarray(row["y_raw"]))
        cache[key] = preprocess(s)
    return cache[key]


def _rank_rows(model: TechniqueModel, Yq: np.ndarray, technique: Technique):
    """Top polymers, classifier and best individual score for each query row."""
    mask = window_mask(technique)
    out = []
    for start in range(0, len(Yq), CHUNK):
        W = np.asarray(Yq[start:start + CHUNK], dtype=np.float64)[:, mask]
        S = correlation_matrix(W, model.refs, MIN_OVERLAP)
        classes, P = polymer_scores(S, model.labels)
        clf = svm_predict(model.svm, pca_transform(model.pca_mean, model.pca_components, W))
        for i in range(len(W)):
            ranked = ranked_polymers(classes, P[i])[:N_CANDIDATES]
            out.append((tuple(p for p, _ in ranked), tuple(round12(s) for _, s in ranked),
                        str(clf[i])))
    return out


def _best_scores(refs: np.ndarray, Yq: np.ndarray, technique: Technique) -> list[float | None]:
    mask = window_mask(technique)
    out: list[float | None] = []
    for start in range(0, len(Yq), CHUNK):
        W = np.asarray(Yq[start:start + CHUNK], dtype=np.float64)[:, mask]
        S = correlation_matrix(W, refs, MIN_OVERLAP)
        best = S.max(axis=1) if S.shape[1] else np.full(len(W), -np.inf)
        out.extend(float(b) if np.isfinite(b) else None for b in best)
    return out


def _guard_for(rows: pd.DataFrame, technique: Technique, guard_refs: pd.DataFrame | None,
               cache: dict[str, np.ndarray]):
    """(other_score, other_coverage) per row: the row read as the other technique."""
    other_t = OTHER[technique]
    scores: list[float | None] = [None] * len(rows)
    covs: list[float | None] = [None] * len(rows)
    if guard_refs is None or guard_refs.empty:
        return scores, covs
    refs = grid_matrix(guard_refs)[:, window_mask(other_t)].astype(np.float64)
    pos, grids = [], []
    for i, (_, row) in enumerate(rows.iterrows()):
        if not _eligible(row):
            continue
        g = _grid_as_other(row, technique, cache)
        cov = diagnostic_coverage(g, other_t)
        covs[i] = cov
        if cov >= MIN_COVERAGE:
            pos.append(i)
            grids.append(g)
    if pos:
        for i, s in zip(pos, _best_scores(refs, np.vstack(grids), other_t), strict=True):
            scores[i] = s
    return scores, covs


def lolo_predictions(df_t: pd.DataFrame, technique: Technique, other: pd.DataFrame | None,
                     *, as_other: dict[str, np.ndarray] | None = None) -> list[LoloPrediction]:
    """Leave-one-library-out predictions: each library is predicted by a model that never saw it."""
    cache = as_other if as_other is not None else {}
    preds: list[LoloPrediction] = []
    for held in sorted(set(df_t["source"])):
        is_held = (df_t["source"] == held).to_numpy()
        train_df = df_t[~is_held].reset_index(drop=True)
        test = df_t[is_held].reset_index(drop=True)
        if train_df.empty:
            continue
        fold = fit_technique(train_df, technique, None)
        known = set(train_df["polymer"])
        ranked = _rank_rows(fold, grid_matrix(test), technique)
        guard = guard_reference(other, held) if other is not None else None
        g_scores, g_covs = _guard_for(test, technique, guard, cache)
        for i, (_, row) in enumerate(test.iterrows()):
            top, scores, clf = ranked[i]
            preds.append(LoloPrediction(
                library=held, true=str(row["polymer"]), in_library=row["polymer"] in known,
                top=top, scores=scores, classifier=clf if top else None,
                coverage=float(row["diagnostic_coverage"]),
                other_score=g_scores[i], other_coverage=g_covs[i]))
    return preds


def wrong_technique_predictions(df_t: pd.DataFrame, technique: Technique,
                                other: pd.DataFrame | None,
                                *, as_other: dict[str, np.ndarray] | None = None
                                ) -> list[LoloPrediction]:
    """Each cm-1 query submitted as the other technique, never seeing its own library."""
    if other is None or other.empty:
        return []
    other_t = OTHER[technique]
    cache = as_other if as_other is not None else {}
    preds: list[LoloPrediction] = []
    for held in sorted(set(df_t["source"])):
        test = df_t[(df_t["source"] == held).to_numpy()].reset_index(drop=True)
        eligible = test[[_eligible(r) for _, r in test.iterrows()]].reset_index(drop=True)
        other_train = guard_reference(other, held)
        if eligible.empty or other_train.empty:
            continue
        fold = fit_technique(other_train, other_t, None)
        known = set(other_train["polymer"])
        grids = [_grid_as_other(r, technique, cache) for _, r in eligible.iterrows()]
        covs = [diagnostic_coverage(g, other_t) for g in grids]
        ok = [i for i, c in enumerate(covs) if c >= MIN_COVERAGE]
        ranked = dict(zip(ok, _rank_rows(fold, np.vstack([grids[i] for i in ok]), other_t),
                          strict=True)) if ok else {}
        true_guard = guard_reference(df_t, held)  # the query's real technique, without its library
        g_scores, g_covs = _guard_for_true(eligible, true_guard, technique)
        for i, (_, row) in enumerate(eligible.iterrows()):
            top, scores, clf = ranked.get(i, ((), (), ""))
            preds.append(LoloPrediction(
                library=held, true=str(row["polymer"]), in_library=row["polymer"] in known,
                top=top, scores=scores, classifier=clf if top else None, coverage=covs[i],
                other_score=g_scores[i], other_coverage=g_covs[i]))
    return preds


def _guard_for_true(rows: pd.DataFrame, true_refs: pd.DataFrame, technique: Technique):
    """Score of each row against its own technique's references (stored y_grid)."""
    if true_refs.empty:
        return [None] * len(rows), [None] * len(rows)
    refs = grid_matrix(true_refs)[:, window_mask(technique)].astype(np.float64)
    scores = _best_scores(refs, grid_matrix(rows), technique)
    return scores, [float(c) for c in rows["diagnostic_coverage"]]


# ----------------------------------------------------------------- statuses and metrics

def predicted_status(p: LoloPrediction, t: Thresholds,
                     t_other: Thresholds | None) -> tuple[Status, Abstention | None]:
    """Status of a LOLO prediction, guards included."""
    if p.coverage < MIN_COVERAGE:
        return Status.NOT_IDENTIFIED, Abstention.LOW_COVERAGE
    if not p.scores:
        return Status.NOT_IDENTIFIED, Abstention.NO_OVERLAP
    if technique_mismatch(p.scores[0], p.other_score, p.other_coverage, t_other):
        return Status.NOT_IDENTIFIED, Abstention.TECHNIQUE_MISMATCH
    s2 = p.scores[1] if len(p.scores) > 1 else None
    st = status_of(p.scores[0], s2, p.top[0], p.classifier, t)
    return st, (Abstention.LOW_SCORE if st == Status.NOT_IDENTIFIED else None)


def _nested(preds: Sequence[LoloPrediction], t_other: Thresholds | None
            ) -> tuple[dict[str, float | None], dict[str, str]]:
    """Per library: precision of 'identified' under thresholds chosen without that library.

    'Identified' follows the deployed rule, technique guard included. A library whose
    estimate cannot be made is reported with None and a reason.
    """
    out: dict[str, float | None] = {}
    reasons: dict[str, str] = {}
    for lib in sorted({p.library for p in preds}):
        rest = [p for p in preds if p.library != lib]
        try:
            t = choose_thresholds(rest)
        except NoThresholds:
            out[lib], reasons[lib] = None, "no_thresholds"
            continue
        ident = [p for p in preds if p.library == lib and p.in_library
                 and predicted_status(p, t, t_other)[0] is Status.IDENTIFIED]
        if ident:
            out[lib] = sum(p.top[0] == p.true for p in ident) / len(ident)
        else:
            out[lib], reasons[lib] = None, "no_identified"
    return out, reasons


def nested_precision(preds: Sequence[LoloPrediction],
                     t_other: Thresholds | None = None) -> dict[str, float | None]:
    """Nested precision of 'identified' per library (None when it cannot be estimated)."""
    return _nested(preds, t_other)[0]


def _share(num: int, den: int) -> float | None:
    return None if den == 0 else num / den


def _status_shares(rows: list[tuple[LoloPrediction, Status, Abstention | None]]) -> dict:
    n = len(rows)
    return {
        "n": n,
        "identified": _share(sum(s == Status.IDENTIFIED for _, s, _ in rows), n),
        "uncertain": _share(sum(s == Status.UNCERTAIN for _, s, _ in rows), n),
        "not_identified": _share(sum(s == Status.NOT_IDENTIFIED for _, s, _ in rows), n),
        "low_score": _share(sum(a == Abstention.LOW_SCORE for _, _, a in rows), n),
        "technique_mismatch": _share(
            sum(a == Abstention.TECHNIQUE_MISMATCH for _, _, a in rows), n),
    }


def _block(preds: Sequence[LoloPrediction], t: Thresholds, t_other: Thresholds | None) -> dict:
    inside = [p for p in preds if p.in_library]
    outside = [p for p in preds if not p.in_library]
    st_in = [(p, *predicted_status(p, t, t_other)) for p in inside]
    st_out = [(p, *predicted_status(p, t, t_other)) for p in outside]
    n = len(inside)
    ident = [p for p, s, _ in st_in if s == Status.IDENTIFIED]
    unc = [p for p, s, _ in st_in if s == Status.UNCERTAIN]
    return {
        "n": len(preds), "n_in_library": n, "n_out_of_library": len(outside),
        "top1": _share(sum(bool(p.top) and p.top[0] == p.true for p in inside), n),
        "top3": _share(sum(p.true in p.top[:3] for p in inside), n),
        "svm_accuracy": _share(sum(p.classifier == p.true for p in inside), n),
        "status_in_library": _status_shares(st_in),
        "status_out_of_library": _status_shares(st_out),
        "identified_precision": _share(sum(p.top[0] == p.true for p in ident), len(ident)),
        "uncertain_top1": _share(sum(p.top[0] == p.true for p in unc), len(unc)),
        "uncertain_top3": _share(sum(p.true in p.top[:3] for p in unc), len(unc)),
    }


def _recall_by_polymer(preds: Sequence[LoloPrediction]) -> dict[str, float]:
    by: dict[str, list[bool]] = {}
    for p in preds:
        if p.in_library:
            by.setdefault(p.true, []).append(bool(p.top) and p.top[0] == p.true)
    return {k: sum(v) / len(v) for k, v in sorted(by.items())}


def _technique_metrics(preds: list[LoloPrediction], wrong: list[LoloPrediction],
                       t: Thresholds, t_other: Thresholds | None) -> dict:
    libs = sorted({p.library for p in preds})
    nested, nested_reasons = _nested(preds, t_other)
    per_lib = {}
    for lib in libs:
        b = _block([p for p in preds if p.library == lib], t, t_other)
        b["nested_identified_precision"] = nested.get(lib)
        per_lib[lib] = b
    glob = _block(preds, t, t_other)
    wrong_rows = [(p, *predicted_status(p, t_other, t)) for p in wrong] if t_other else []
    return {
        "global": glob, "per_library": per_lib,
        "nested_identified_precision": nested,
        "nested_unavailable": nested_reasons,
        "recall_by_polymer": _recall_by_polymer(preds),
        "wrong_technique": _status_shares(wrong_rows),
    }


# ----------------------------------------------------------------- training

def _params() -> dict:
    return {
        "seed": SEED, "min_coverage": MIN_COVERAGE, "min_overlap": MIN_OVERLAP,
        "pca_components": PCA_COMPONENTS, "pca_solver": "full",
        "svm": "SVC(kernel=rbf, C=1.0, gamma=scale, class_weight=balanced)",
        "n_candidates": N_CANDIDATES, "n_references": N_REFERENCES,
        "technique_mismatch_margin": TECHNIQUE_MISMATCH_MARGIN, "plot_stride": PLOT_STRIDE,
        "windows": {t: list(w) for t, w in DIAGNOSTIC_WINDOWS.items()},
        "grids": {"uncertain": list(th.UNCERTAIN_GRID), "identified": list(th.IDENTIFIED_GRID),
                  "margin": list(th.MARGIN_GRID)},
        "criteria": {
            "identified_min_precision": th.IDENTIFIED_MIN_PRECISION,
            "library_min_precision": th.LIBRARY_MIN_PRECISION,
            "uncertain_min_top3": th.UNCERTAIN_MIN_TOP3,
            "library_min_top3": th.LIBRARY_MIN_TOP3,
            "out_of_library_max_identified": th.OUT_OF_LIBRARY_MAX_IDENTIFIED,
            "min_library_answers": th.MIN_LIBRARY_ANSWERS,
            "min_out_of_library": th.MIN_OUT_OF_LIBRARY},
        "preprocess_version": PREPROCESS_VERSION,
    }


def train(df: pd.DataFrame, baseline: Mapping) -> tuple[SpectralModel, dict]:
    """Gate on the baseline, run LOLO, choose thresholds, fit the final model.

    Returns the model and the manifest body (no date, no commit).
    """
    reproduction = reproduce_baseline(df, baseline)
    frames = {t: training_frame(df, t) for t in TECHNIQUES}
    techniques = [t for t in TECHNIQUES if not frames[t].empty]
    cache: dict[str, np.ndarray] = {}
    preds, wrong, thresholds = {}, {}, {}
    for t in techniques:
        other = frames.get(OTHER[t])
        other = other if other is not None and not other.empty else None
        preds[t] = lolo_predictions(frames[t], t, other, as_other=cache)
        thresholds[t] = choose_thresholds(preds[t])
        wrong[t] = wrong_technique_predictions(frames[t], t, other, as_other=cache)

    metrics = {}
    for t in techniques:
        o = OTHER[t]
        metrics[t] = _technique_metrics(
            preds[t], wrong[t], thresholds[t], thresholds.get(o))

    models = {t: fit_technique(frames[t], t, thresholds[t], verify=True) for t in techniques}
    summary = {t: {"global": metrics[t]["global"],
                   "nested_identified_precision": metrics[t]["nested_identified_precision"],
                   "nested_unavailable": metrics[t]["nested_unavailable"],
                   "wrong_technique": metrics[t]["wrong_technique"]} for t in techniques}
    meta = {"params": _params(), "metrics": summary}
    model = SpectralModel(name=SPECTRAL_MODEL_NAME, version=SPECTRAL_MODEL_VERSION,
                          techniques=models, meta=meta)
    body = {
        "model": {"name": SPECTRAL_MODEL_NAME, "version": SPECTRAL_MODEL_VERSION,
                  "file": MODEL_FILE},
        "params": _params(),
        "data": {
            "counts": {t: {
                "n": len(frames[t]),
                "by_source": {k: int(v) for k, v in
                              frames[t]["source"].value_counts().sort_index().items()},
                "by_polymer": {k: int(v) for k, v in
                               frames[t]["polymer"].value_counts().sort_index().items()},
            } for t in techniques},
            "exclusions": {t: _exclusions(df, t) for t in techniques},
        },
        "thresholds": {t: asdict(thresholds[t]) for t in techniques},
        "baseline_reproduction": reproduction,
        "metrics": metrics,
    }
    return model, body


# ----------------------------------------------------------------- reports

def _pct(v: float | None) -> str:
    return "n/d" if v is None else f"{100 * v:.1f} %".replace(".", ",")


def _fr(v: float) -> str:
    return f"{v:g}".replace(".", ",")


def _threshold_sentence(thr: Mapping) -> str:
    base = f"Seuils : incertain dès {_fr(thr['uncertain_min_score'])}, identifié dès "            f"{_fr(thr['identified_min_score'])}"
    margin = thr["identified_min_margin"]
    if not margin:
        return f"{base}, sans écart minimal exigé."
    return f"{base} avec une marge d'au moins {_fr(margin)}."


def render_card_metrics(manifest: Mapping) -> str:
    """Markdown metrics block for the model card (content between the markers)."""
    L: list[str] = []
    repro = manifest.get("baseline_reproduction", {})
    if repro:
        L += ["**Porte de reproduction de la baseline** (corrélation sur la grille entière, LOLO)", "",
              "| Technique | Attendu | Mesuré | Écart |", "|---|---|---|---|"]
        L += [f"| {t} | {r['expected']:.6f} | {r['measured']:.6f} | {r['delta']:+.6f} |"
              for t, r in repro.items()]
        L.append("")
    for t, m in manifest["metrics"].items():
        thr = manifest["thresholds"][t]
        g = m["global"]
        L += [f"### {t}", "",
              _threshold_sentence(thr), "",
              "| Bibliothèque tenue à part | Dans | Hors | Top-1 | Top-3 | SVM | Identifié "
              "| Incertain | Non identifié | Précision « identifié » | Précision imbriquée |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
        rows = [("global", g, None), *((k, v, v.get("nested_identified_precision"))
                                       for k, v in m["per_library"].items())]
        for name, b, nested in rows:
            s = b["status_in_library"]
            L.append(
                f"| {name} | {b['n_in_library']} | {b['n_out_of_library']} | {_pct(b['top1'])} "
                f"| {_pct(b['top3'])} | {_pct(b['svm_accuracy'])} | {_pct(s['identified'])} "
                f"| {_pct(s['uncertain'])} | {_pct(s['not_identified'])} "
                f"| {_pct(b['identified_precision'])} | {_pct(nested)} |")
        so = g["status_out_of_library"]
        si = g["status_in_library"]
        w = m["wrong_technique"]
        L += ["", f"Hors bibliothèque ({so['n']} requêtes) : identifié {_pct(so['identified'])}, "
              f"incertain {_pct(so['uncertain'])}, non identifié {_pct(so['not_identified'])}.",
              "", "Spectre soumis avec la mauvaise technique "
              f"({w.get('n', 0)} requêtes, population complète de la validation) : "
              f"non identifié {_pct(w.get('not_identified'))} "
              f"(dont signalé par la garde {_pct(w.get('technique_mismatch'))}), "
              f"incertain {_pct(w.get('uncertain'))}, identifié {_pct(w.get('identified'))}.",
              "", "Faux signalements de la garde sur des spectres bien déclarés "
              f"(dans la bibliothèque, {si['n']} requêtes) : {_pct(si.get('technique_mismatch'))} "
              "(borne visée : 5,0 % au plus ; "
              + ("respectée" if (si.get("technique_mismatch") or 0) <= 0.05 else "NON respectée")
              + ").", ""]
        counts = manifest.get("data", {}).get("counts", {}).get(t)
        if counts and counts.get("n"):
            share = counts["by_source"].get("mpx", 0) / counts["n"]
            L += [f"Part de MicroPlastiX dans les références : {_pct(share)} "
                  f"({counts['n']} spectres).", ""]
        L += ["| Polymère | Rappel top-1 |", "|---|---|"]
        L += [f"| {k} | {_pct(v)} |" for k, v in m["recall_by_polymer"].items()]
        L.append("")
        by_polymer = (counts or {}).get("by_polymer", {})
        single = [f"{k} ({by_polymer[k]})" for k in sorted(by_polymer)
                  if k not in m["recall_by_polymer"]]
        if single:
            L += ["Polymères présents dans une seule bibliothèque (non évalués : la validation "
                  "les traite toujours comme hors bibliothèque, leur rappel n'a jamais été "
                  f"mesuré) : {', '.join(single)}.", ""]
    return "\n".join(L)


def replace_metrics_block(text: str, block: str) -> str:
    """Replace what lies between the markers; everything else is kept byte for byte."""
    i, j = text.find(BEGIN_MARKER), text.find(END_MARKER)
    if i < 0 or j < i:
        raise ValueError("model card has no metrics block markers")
    return text[: i + len(BEGIN_MARKER)] + "\n" + block.strip("\n") + "\n" + text[j:]


# ----------------------------------------------------------------- command

def _sha256_file(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _atomic_write(path: Path, data: bytes) -> None:
    """Write through a temporary file in the same folder, then replace."""
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
    """Path relative to the working directory when possible (no absolute path in the manifest)."""
    p = Path(path).resolve()
    try:
        return p.relative_to(Path.cwd().resolve()).as_posix()
    except ValueError:
        return Path(path).as_posix()


def run_training(*, catalog: Path, baseline: Path, models_dir: Path, manifest: Path,
                 data_list: Path, lock: Path, card: Path | None, check: bool = False) -> int:
    """Train, evaluate and write the artefacts. Exit codes: 0, 3 baseline, 4 sha, 5 thresholds."""
    catalog, baseline = Path(catalog), Path(baseline)
    df = load_catalog(catalog)
    base = json.loads(baseline.read_text(encoding="utf-8"))
    try:
        model, body = train(df, base)
    except BaselineMismatch as exc:
        print(str(exc), file=sys.stderr)
        return 3
    except NoThresholds as exc:
        print(f"no thresholds: {exc}", file=sys.stderr)
        return 5

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

    kept = pd.concat([training_frame(df, t) for t in TECHNIQUES])
    lines = sorted({f"{r.file_sha256}  {r.file}" for r in kept.itertuples()})
    list_bytes = ("\n".join(lines) + "\n").encode("utf-8")

    cmeta: dict = {}
    try:
        cmeta = json.loads((catalog.parent / "catalog_meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    body["model"].update({"sha256": sha, "size_bytes": len(data)})
    body["trained_at"] = date.today().isoformat()
    body["code"] = {
        "git_commit": _git_commit(), "git_dirty": _git_dirty(),
        "preprocess_version": PREPROCESS_VERSION, "numpy": np.__version__,
        "scipy": scipy.__version__, "scikit-learn": sklearn.__version__,
        "python": platform.python_version()}
    body["data"].update({
        "catalog_sha256": _sha256_file(catalog),
        "catalog_built_at": cmeta.get("built_at"),
        "catalog_git_commit": cmeta.get("git_commit"),
        "data_list": {"path": _display_path(data_list),
                      "sha256": hashlib.sha256(list_bytes).hexdigest(), "files": len(lines)},
        "n_by_technique": dict(Counter(kept["technique"])),
    })
    lock_obj = {"name": SPECTRAL_MODEL_NAME, "version": SPECTRAL_MODEL_VERSION,
                "file": MODEL_FILE, "sha256": sha}

    _atomic_write(Path(models_dir) / MODEL_FILE, data)
    _atomic_write(Path(data_list), list_bytes)
    _atomic_write(Path(manifest), _json_bytes(body))
    _atomic_write(Path(lock), _json_bytes(lock_obj))
    if card_text is not None:
        _atomic_write(Path(card), card_text)
    return 0
