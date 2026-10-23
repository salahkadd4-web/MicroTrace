"""Baseline evaluation: correlation matching and PCA+SVM under leakage-safe protocols."""

from __future__ import annotations

import json
import time
from collections import Counter
from collections.abc import Callable, Sequence
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import f1_score

from microtrace_core.catalog import grid_matrix, load_catalog
from microtrace_ml.classifier import make_pca_svm
from microtrace_ml.matching import NO_MATCH, CorrelationMatcher
from microtrace_ml.splits import group_kfold, leave_one_source_out, pristine_to_aged

EVAL_EXCLUDED = {"UNKNOWN", "OTHER"}
MIN_COVERAGE = 0.8
N_SPLITS = 5
MAX_COMPONENTS = 30
DEFAULT_DATA_NATURE = "unknown"


class _Skip(Exception):
    """A method cannot run on a fold; the reason is recorded, not hidden."""


def evaluate_predictions(y_true: Sequence[str], y_pred: Sequence[str]) -> dict:
    """Metrics for one set of predictions; ``NO_MATCH`` counts as an error."""
    t = np.array([str(v) for v in y_true], dtype=object)
    p = np.array([str(v) for v in y_pred], dtype=object)
    n = len(t)
    if n == 0:
        return {"n": 0, "accuracy": None, "macro_f1": None, "coverage": None,
                "per_class_recall": {}, "confusion": {}}
    classes = sorted(set(t))
    return {
        "n": n,
        "accuracy": float(np.mean(t == p)),
        "macro_f1": float(f1_score(t, p, labels=classes, average="macro", zero_division=0)),
        "coverage": float(np.mean(p != NO_MATCH)),
        "per_class_recall": {c: float(np.mean(p[t == c] == c)) for c in classes},
        "confusion": {c: dict(sorted(Counter(p[t == c]).items())) for c in classes},
    }


def _scored(y_true: np.ndarray, y_pred: np.ndarray, in_lib: np.ndarray) -> dict:
    """Metrics on in-library queries; out-of-library ones are only counted."""
    m = evaluate_predictions(y_true[in_lib], y_pred[in_lib])
    m["n_evaluated"] = m["n"]
    m["n"] = int(len(y_true))
    m["out_of_library"] = int((~in_lib).sum())
    return m


def _in_library(y_true: np.ndarray, classes: set) -> np.ndarray:
    return np.array([t in classes for t in y_true], dtype=bool)


def _correlation_predictor(threshold: float) -> Callable:
    def predict(Y_tr, y_tr, ids_tr, Q):
        matcher = CorrelationMatcher().fit(Y_tr, y_tr, ids_tr)
        return matcher.predict(Q, threshold=threshold).labels

    return predict


def _pca_svm_predict(Y_tr, y_tr, ids_tr, Q):
    if len(set(y_tr)) < 2:
        raise _Skip("training set has fewer than 2 classes")
    n_comp = min(MAX_COMPONENTS, len(y_tr) - 1, Y_tr.shape[1])
    model = make_pca_svm(n_components=n_comp).fit(Y_tr, y_tr)
    return model.predict(Q)


def _methods(threshold: float) -> dict[str, Callable]:
    return {
        "correlation@0": _correlation_predictor(0.0),
        f"correlation@{threshold:g}": _correlation_predictor(threshold),
        "pca_svm": _pca_svm_predict,
    }


def _run_folds(
    Y: np.ndarray, y: np.ndarray, ids: np.ndarray,
    folds: list[tuple[np.ndarray, np.ndarray]], methods: dict[str, Callable],
) -> dict[str, list]:
    """Per method, one entry per fold: (test_idx, y_pred, library_classes) or _Skip."""
    out: dict[str, list] = {name: [] for name in methods}
    for train, test in folds:
        for name, fn in methods.items():
            if len(train) == 0 or len(test) == 0:
                out[name].append(_Skip("empty train or test set"))
                continue
            try:
                pred = fn(Y[train], y[train], ids[train], Y[test])
            except _Skip as exc:
                out[name].append(_Skip(str(exc)))
                continue
            out[name].append((test, np.asarray(pred, dtype=object), set(y[train])))
    return out


def _pool(y: np.ndarray, results: list) -> dict:
    """Metrics pooled over folds; skipped folds are listed, not hidden."""
    done = [r for r in results if not isinstance(r, _Skip)]
    skipped = [str(r) for r in results if isinstance(r, _Skip)]
    if not done:
        return {"skipped": "; ".join(sorted(set(skipped))) or "no fold"}
    yt = np.concatenate([y[test] for test, _, _ in done])
    yp = np.concatenate([pred for _, pred, _ in done])
    lib = np.concatenate([_in_library(y[test], classes) for test, _, classes in done])
    m = _scored(yt, yp, lib)
    if skipped:
        m["skipped_folds"] = skipped
    return m


def _exclusions(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    counts = {"UNKNOWN": int((df["polymer"] == "UNKNOWN").sum()),
              "OTHER": int((df["polymer"] == "OTHER").sum())}
    kept = df[~df["polymer"].isin(EVAL_EXCLUDED)]
    low = ~(kept["coverage"] >= MIN_COVERAGE)  # NaN coverage is excluded too
    counts["low_coverage"] = int(low.sum())
    counts["total"] = sum(counts.values())
    return kept[~low].reset_index(drop=True), counts


def _evaluate_technique(df: pd.DataFrame, threshold: float) -> dict:
    df, excluded = _exclusions(df)
    result: dict = {
        "excluded": excluded,
        "n": int(len(df)),
        "by_source": {k: int(v) for k, v in df["source"].value_counts().sort_index().items()},
        "by_polymer": {k: int(v) for k, v in df["polymer"].value_counts().sort_index().items()},
        "protocols": {},
    }
    if df.empty:
        return result
    methods = _methods(threshold)
    Y = grid_matrix(df)
    y = df["polymer"].to_numpy(dtype=object)
    ids = df["spectrum_id"].to_numpy(dtype=object)
    protocols = result["protocols"]

    # Leave-one-source-out: per held-out source and pooled.
    loso = list(leave_one_source_out(df))
    res = _run_folds(Y, y, ids, [(tr, te) for _, tr, te in loso], methods)
    per_source: dict = {}
    for k, (src, _, test) in enumerate(loso):
        per_source[src] = {}
        for name in methods:
            r = res[name][k]
            per_source[src][name] = (
                {"skipped": str(r)} if isinstance(r, _Skip)
                else _scored(y[test], r[1], _in_library(y[test], r[2]))
            )
    protocols["loso"] = {
        "per_source": per_source,
        "pooled": {name: _pool(y, res[name]) for name in methods},
    }

    # Grouped k-fold on polymers with enough distinct sample groups.
    n_groups = df.groupby("polymer")["sample_group"].nunique()
    keep_poly = set(n_groups[n_groups >= N_SPLITS].index)
    dropped = df[~df["polymer"].isin(keep_poly)]
    gk_excl = {
        "total": int(len(dropped)),
        "polymers_with_fewer_than_5_groups": {
            k: int(v) for k, v in dropped["polymer"].value_counts().sort_index().items()
        },
    }
    if len(keep_poly) < 2:
        protocols["group_kfold"] = {
            "excluded": gk_excl,
            "skipped": "fewer than 2 polymers with >= 5 sample groups",
        }
    else:
        pos = np.flatnonzero(df["polymer"].isin(keep_poly).to_numpy())
        sub = df.iloc[pos].reset_index(drop=True)
        folds = [(pos[tr], pos[te]) for tr, te in group_kfold(sub, N_SPLITS, seed=0)]
        res = _run_folds(Y, y, ids, folds, methods)
        protocols["group_kfold"] = {
            "excluded": gk_excl,
            "n_splits": N_SPLITS,
            "seed": 0,
            "methods": {name: _pool(y, res[name]) for name in methods},
        }

    # Pristine -> weathered/biofouled.
    train, test = pristine_to_aged(df)
    if len(train) == 0 or len(test) == 0:
        protocols["pristine_to_aged"] = {"skipped": "no pristine train set or no aged test set"}
    else:
        res = _run_folds(Y, y, ids, [(train, test)], methods)
        protocols["pristine_to_aged"] = {
            "methods": {name: _pool(y, res[name]) for name in methods}
        }
    return result


def _catalog_meta(catalog_path: Path) -> dict:
    try:
        meta = json.loads((catalog_path.parent / "catalog_meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        meta = {}
    return {
        "git_commit": meta.get("git_commit", "unknown"),
        "data_nature": meta.get("data_nature", DEFAULT_DATA_NATURE),
    }


def run_baseline(catalog_path: Path, out_dir: Path, threshold: float = 0.7) -> dict:
    """Evaluate every technique x protocol x method; write metrics.json and report.md."""
    catalog_path, out_dir = Path(catalog_path), Path(out_dir)
    t0 = time.time()
    df = load_catalog(catalog_path)
    df["sample_group"] = df["sample_group"].fillna(df["spectrum_id"])
    result: dict = {
        "date": date.today().isoformat(),
        "catalog": _catalog_meta(catalog_path),
        "threshold": threshold,
        "min_coverage": MIN_COVERAGE,
        "techniques": {},
    }
    for technique in sorted(set(df["technique"])):
        result["techniques"][technique] = _evaluate_technique(
            df[df["technique"] == technique].reset_index(drop=True), threshold
        )
    result["runtime_seconds"] = round(time.time() - t0, 1)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "metrics.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "report.md").write_text(_render_report(result), encoding="utf-8")
    return result


# ---------------------------------------------------------------- report (French)

def _fmt(v, digits: int = 3) -> str:
    return "n/a" if v is None else f"{v:.{digits}f}"


def _metrics_table(methods: dict) -> list[str]:
    lines = ["| Méthode | n | accuracy | macro-F1 | coverage | out_of_library |",
             "|---|---|---|---|---|---|"]
    for name, m in methods.items():
        if "skipped" in m:
            lines.append(f"| {name} | – | ignoré : {m['skipped']} | | | |")
        else:
            lines.append(f"| {name} | {m['n']} | {_fmt(m['accuracy'])} | {_fmt(m['macro_f1'])} "
                         f"| {_fmt(m['coverage'])} | {m['out_of_library']} |")
    return lines


def _recall_table(methods: dict) -> list[str]:
    names = [n for n, m in methods.items() if "skipped" not in m]
    if not names:
        return []
    classes = sorted({c for n in names for c in methods[n]["per_class_recall"]})
    lines = ["| Polymère | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
    for c in classes:
        cells = [_fmt(methods[n]["per_class_recall"].get(c)) for n in names]
        lines.append(f"| {c} | " + " | ".join(cells) + " |")
    return lines


_PROTOCOL_TITLES = {
    "loso": "Leave-one-source-out (LOSO)",
    "group_kfold": "Validation croisée par groupes (group_kfold)",
    "pristine_to_aged": "Pristine vers vieilli (pristine_to_aged)",
}


def _render_report(r: dict) -> str:
    thr = f"{r['threshold']:g}"
    L = [
        "# MicroTrace : rapport de la baseline d'identification des polymères",
        "",
        f"- Date : {r['date']}",
        f"- Catalogue (git_commit) : `{r['catalog']['git_commit']}`",
        f"- Nature des données : {r['catalog']['data_nature']}",
        f"- Seuil de corrélation testé : {thr}",
        f"- Durée du calcul : {r['runtime_seconds']} s",
        "",
        "Ce rapport mesure dans quelle mesure le polymère d'un échantillon peut être "
        "retrouvé à partir de son spectre, avec des séparations qui évitent toute fuite "
        "de données entre apprentissage et test. Trois méthodes sont comparées : "
        "`correlation@0` (le spectre de référence le plus proche est toujours retenu), "
        f"`correlation@{thr}` (la réponse est NO_MATCH si la corrélation est inférieure "
        "au seuil) et `pca_svm` (réduction PCA puis machine à vecteurs de support).",
        "",
        "Lecture des colonnes : `n` = requêtes testées ; `accuracy` = part de bonnes "
        "réponses (un NO_MATCH compte comme une erreur) ; `macro-F1` = moyenne du F1 "
        "par polymère, qui donne le même poids aux polymères rares ; `coverage` = part des "
        "requêtes pour lesquelles une réponse est donnée ; `out_of_library` = requêtes dont "
        "le polymère n'existe pas dans la bibliothèque d'apprentissage (comptées à part, "
        "exclues de accuracy et macro-F1).",
        "",
    ]
    for tech, t in r["techniques"].items():
        ex = t["excluded"]
        L += [
            f"## Technique : {tech}", "",
            f"Spectres évalués après exclusions : {t['n']}. Exclus avant toute séparation : "
            f"{ex['total']} (polymère UNKNOWN : {ex['UNKNOWN']}, polymère OTHER : {ex['OTHER']}, "
            f"couverture < {r['min_coverage']} : {ex['low_coverage']}).", "",
            "### Effectifs par source", "",
            "| Source | Spectres |", "|---|---|",
            *[f"| {k} | {v} |" for k, v in t["by_source"].items()], "",
            "### Effectifs par polymère", "",
            "| Polymère | Spectres |", "|---|---|",
            *[f"| {k} | {v} |" for k, v in t["by_polymer"].items()], "",
        ]
        for proto, title in _PROTOCOL_TITLES.items():
            p = t["protocols"].get(proto)
            if p is None:
                continue
            L += [f"### {title}", ""]
            if "skipped" in p:
                L += [f"Protocole ignoré : {p['skipped']}.", ""]
                continue
            if proto == "loso":
                L += ["Résultats cumulés sur toutes les sources tenues à part :", ""]
                L += _metrics_table(p["pooled"]) + [""]
                for src, methods in p["per_source"].items():
                    L += [f"Source tenue à part : **{src}**", ""]
                    L += _metrics_table(methods) + [""]
                L += ["Rappel par polymère (LOSO cumulé) :", ""]
                L += _recall_table(p["pooled"]) + [""]
                continue
            if proto == "group_kfold":
                e = p["excluded"]
                L += [f"Validation croisée en {p['n_splits']} plis, graine {p['seed']} : "
                      "aucun groupe d'échantillons n'est coupé entre apprentissage et "
                      "test. Seuls les polymères présents dans au moins 5 groupes sont "
                      f"conservés ; {e['total']} spectres retirés "
                      f"({e['polymers_with_fewer_than_5_groups']}). Résultats cumulés "
                      "sur les prédictions hors pli :", ""]
            L += _metrics_table(p["methods"]) + [""]
            if proto == "pristine_to_aged":
                L += ["Rappel par polymère :", ""]
                L += _recall_table(p["methods"]) + [""]
    L += [
        "## Limites", "",
        "- Les données sont des polymères de référence ou environnementaux, pas des "
        "matrices biologiques humaines.",
        "- Il n'existe aucune classe négative (particule non plastique) : le système n'a "
        "jamais appris à répondre « ce n'est pas un plastique ».",
        "- Les résultats de chaque protocole ne sont pas comparables à une performance "
        "clinique.",
        "- Les protocoles diffèrent par leur difficulté : ne comparer les chiffres qu'à "
        "l'intérieur d'un même protocole.",
        "",
    ]
    return "\n".join(L)
