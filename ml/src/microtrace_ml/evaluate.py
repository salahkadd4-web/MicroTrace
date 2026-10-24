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
SEED = 0
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
    model = make_pca_svm(n_components=n_comp, random_state=SEED).fit(Y_tr, y_tr)
    return model.predict(Q)


def _methods(threshold: float) -> dict[str, Callable]:
    key = f"correlation@{threshold:g}"
    if key == "correlation@0":
        raise ValueError("threshold must differ from 0 (correlation@0 is always evaluated)")
    return {
        "correlation@0": _correlation_predictor(0.0),
        key: _correlation_predictor(threshold),
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


def _exclusion_reasons(df: pd.DataFrame) -> pd.Series:
    """Per row: "UNKNOWN", "OTHER", "low_coverage" or "" (kept)."""
    reason = pd.Series("", index=df.index, dtype=object)
    bad_label = df["polymer"].isin(EVAL_EXCLUDED)
    reason[bad_label] = df.loc[bad_label, "polymer"]
    low = ~bad_label & ~(df["coverage"] >= MIN_COVERAGE)  # NaN coverage is excluded too
    reason[low] = "low_coverage"
    return reason


def _count_reasons(reason: pd.Series) -> dict:
    counts = {k: int((reason == k).sum()) for k in ("UNKNOWN", "OTHER", "low_coverage")}
    counts["total"] = sum(counts.values())
    return counts


def _exclusions(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    reason = _exclusion_reasons(df)
    counts = _count_reasons(reason)
    counts["by_source"] = {
        src: _count_reasons(reason[df["source"] == src]) for src in sorted(set(df["source"]))
    }
    return df[reason == ""].reset_index(drop=True), counts


def _pooled_share(per_source: dict, method: str = "correlation@0") -> dict:
    """Share of the pooled LOSO in-library queries contributed by each held-out source."""
    n_eval = {src: m[method].get("n_evaluated", 0) for src, m in per_source.items()}
    total = sum(n_eval.values())
    return {src: (n / total if total else 0.0) for src, n in n_eval.items()}


def top_confusions(confusion: dict, k: int = 10) -> list[tuple[str, str, int]]:
    """Largest off-diagonal (true, predicted, count) cells, ties broken by name."""
    pairs = [(t, p, int(c)) for t, row in confusion.items() for p, c in row.items()
             if p != t and c > 0]
    return sorted(pairs, key=lambda x: (-x[2], x[0], x[1]))[:k]


def _evaluate_technique(df: pd.DataFrame, threshold: float) -> dict:
    df, excluded = _exclusions(df)
    result: dict = {
        "excluded": excluded,
        "n": int(len(df)),
        "by_source": {k: int(v) for k, v in df["source"].value_counts().sort_index().items()},
        "groups_by_source": {
            k: int(v)
            for k, v in df.groupby("source")["sample_group"].nunique().sort_index().items()
        },
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
        "pooled_share_by_source": _pooled_share(per_source),
    }

    # Grouped k-fold on polymers with enough distinct sample groups.
    n_groups = df.groupby("polymer")["sample_group"].nunique()
    keep_poly = set(n_groups[n_groups >= N_SPLITS].index)
    dropped = df[~df["polymer"].isin(keep_poly)]
    gk_excl = {
        "total": int(len(dropped)),
        "polymers_with_fewer_groups_than_splits": {
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
        folds = [(pos[tr], pos[te]) for tr, te in group_kfold(sub, N_SPLITS, seed=SEED)]
        res = _run_folds(Y, y, ids, folds, methods)
        protocols["group_kfold"] = {
            "excluded": gk_excl,
            "n_splits": N_SPLITS,
            "seed": SEED,
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
        "git_dirty": meta.get("git_dirty", "unknown"),
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
    lines = ["| Méthode | n | n_evaluated | accuracy | macro-F1 | taux de réponse "
             "| out_of_library |",
             "|---|---|---|---|---|---|---|"]
    notes = []
    for name, m in methods.items():
        if "skipped" in m:
            lines.append(f"| {name} | – | – | ignoré : {m['skipped']} | | | |")
            continue
        lines.append(f"| {name} | {m['n']} | {m['n_evaluated']} | {_fmt(m['accuracy'])} "
                     f"| {_fmt(m['macro_f1'])} | {_fmt(m['coverage'])} | {m['out_of_library']} |")
        if m.get("skipped_folds"):
            notes.append(f"Plis ignorés pour {name} : " + " ; ".join(m["skipped_folds"]) + ".")
    lines += ["", ACCURACY_NOTE]
    for note in notes:
        lines += ["", note]
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


ACCURACY_NOTE = (
    "Accuracy, macro-F1 et taux de réponse sont calculés uniquement sur les requêtes "
    "présentes dans la bibliothèque (n_evaluated = n − out_of_library)."
)

GROUPS_NOTE = (
    "Aucun groupe d'échantillons connu n'est partagé entre apprentissage et test. "
    "Les groupes sont définis par source : MPX = produit (champ Polymer) ; "
    "RaSPI = identifiant sans la lettre finale ; FLOPP, FLOPP-e, SLoPP, SLoPP-E et "
    "raman_weathered = un groupe par spectre (les spectres répétés d'un même objet, "
    "s'il y en a, ne sont pas regroupés)."
)


def _dirty_text(v) -> str:
    if v is True:
        return "oui"
    if v is False:
        return "non"
    return "inconnu"


def _excluded_table(by_source: dict, min_cov: float) -> list[str]:
    lines = [f"| Source | UNKNOWN | OTHER | couverture < {min_cov} | Total |",
             "|---|---|---|---|---|"]
    for src, c in by_source.items():
        lines.append(f"| {src} | {c['UNKNOWN']} | {c['OTHER']} | {c['low_coverage']} "
                     f"| {c['total']} |")
    return lines


def _confusion_table(m: dict) -> list[str]:
    if "skipped" in m:
        return []
    pairs = top_confusions(m["confusion"])
    if not pairs:
        return ["Aucune confusion.", ""]
    return ["| Polymère réel | Prédiction | Nombre |", "|---|---|---|",
            *[f"| {t} | {p} | {c} |" for t, p, c in pairs], ""]


def _pct(v: float) -> str:
    return f"{100 * v:.0f} %"


def _technique_limits(r: dict) -> list[str]:
    """Computed bullets: effective sample size and LOSO source share, per technique."""
    size, share = [], []
    for tech, t in r["techniques"].items():
        if t["by_source"]:
            src = max(sorted(t["by_source"]), key=lambda k: t["by_source"][k])
            size.append(f"{tech} : {src} = {t['by_source'][src]} spectres issus de "
                        f"{t['groups_by_source'][src]} groupes")
        sh = t["protocols"].get("loso", {}).get("pooled_share_by_source")
        if sh:
            src = max(sorted(sh), key=lambda k: sh[k])
            share.append(f"{tech} : {src} = {_pct(sh[src])} des requêtes évaluées")
    out = []
    if size:
        out.append(
            "- Taille effective de l'échantillon : `n` compte des spectres, pas des "
            "échantillons indépendants (" + " ; ".join(size) + "). Certains rappels par "
            "polymère reflètent essentiellement un seul produit. Aucun intervalle de "
            "confiance n'est calculé.")
    if share:
        out.append(
            "- Le LOSO cumulé est dominé par une source (" + " ; ".join(share) + ") : "
            "le chiffre cumulé décrit surtout cette source ; lire aussi les résultats "
            "par source tenue à part.")
    return out

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
        f"- Catalogue (git_commit) : `{r['catalog']['git_commit']}` "
        f"(modifications non commitées : {_dirty_text(r['catalog'].get('git_dirty'))})",
        "- Nature des données (valeur `data_nature` du catalogue) : "
        f"{r['catalog']['data_nature']}",
        f"- Seuil de corrélation testé : {thr}",
        f"- Durée du calcul : {r['runtime_seconds']} s",
        "",
        "Ce rapport mesure dans quelle mesure le polymère d'un échantillon peut être "
        "retrouvé à partir de son spectre, avec des séparations par groupe "
        "d'échantillons entre apprentissage et test. Trois méthodes sont comparées : "
        "`correlation@0` (le spectre de référence le plus proche est toujours retenu), "
        f"`correlation@{thr}` (la réponse est NO_MATCH si la corrélation est inférieure "
        "au seuil) et `pca_svm` (réduction PCA puis machine à vecteurs de support).",
        "",
        GROUPS_NOTE,
        "",
        "Lecture des colonnes : `n` = requêtes testées ; `accuracy` = part de bonnes "
        "réponses (un NO_MATCH compte comme une erreur) ; `macro-F1` = moyenne du F1 "
        "par polymère, qui donne le même poids aux polymères rares ; `taux de réponse` "
        "(clé `coverage` dans metrics.json) = part des requêtes pour lesquelles une "
        "réponse est donnée ; `out_of_library` = requêtes dont "
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
            "### Spectres exclus par source", "",
            *_excluded_table(ex["by_source"], r["min_coverage"]), "",
            "### Effectifs par source", "",
            "| Source | Spectres | Groupes d'échantillons |", "|---|---|---|",
            *[f"| {k} | {v} | {t['groups_by_source'][k]} |"
              for k, v in t["by_source"].items()], "",
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
                L += ["Principales confusions (LOSO cumulé, correlation@0, polymère réel "
                      "→ prédiction, 10 premières) :", ""]
                L += _confusion_table(p["pooled"]["correlation@0"])
                continue
            if proto == "group_kfold":
                e = p["excluded"]
                rare = e["polymers_with_fewer_groups_than_splits"]
                removed = (" (" + ", ".join(f"{k} : {v}" for k, v in rare.items()) + ")") if rare else ""
                L += [f"Validation croisée en {p['n_splits']} plis, graine {p['seed']} : "
                      "aucun groupe d'échantillons n'est coupé entre apprentissage et "
                      "test. Seuls les polymères présents dans au moins "
                      f"{N_SPLITS} groupes sont conservés ; {e['total']} spectres "
                      f"retirés{removed}. Résultats cumulés sur les prédictions hors pli :", ""]
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
        "- Provenance des étiquettes : celles de raman_weathered viennent de scores de "
        "recherche en bibliothèque KnowItAll (certaines « identifiées subjectivement ») ; "
        "celles des échantillons environnementaux de FLOPP-e et SLoPP-E proviennent "
        "probablement d'une comparaison spectrale. Sur ces sources, les scores mesurent "
        "l'accord avec une identification de référence, pas une vérité terrain.",
        *_technique_limits(r),
        "- Le macro-F1 favorise l'abstention : un NO_MATCH n'est jamais un faux positif "
        "pour aucune classe. Comparer les seuils sur l'accuracy et le taux de réponse, "
        "pas sur le seul macro-F1.",
        f"- Règle de couverture : un spectre couvrant moins de {r['min_coverage']} de la "
        "grille est exclu. Les spectres limités surtout à la région d'empreinte digitale "
        "(p. ex. de nombreux spectres SLoPP, ~100–2000 cm⁻¹) ne sont donc pas évalués.",
        "",
    ]
    return "\n".join(L)
