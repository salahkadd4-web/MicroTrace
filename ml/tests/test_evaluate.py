import json

import numpy as np
import pandas as pd
import pytest

from microtrace_core.preprocess import GRIDS
from microtrace_ml.cli import main
from microtrace_ml.evaluate import evaluate_predictions, run_baseline


def _grid_len():
    return len(GRIDS["ftir_atr"])


def _row(i, src, polymer, group, state, y, coverage=1.0, diagnostic_coverage=None):
    return {
        "spectrum_id": f"{src}:{i}", "source": src, "technique": "ftir_atr",
        "polymer": polymer, "polymer_raw": polymer, "state": state,
        "sample_group": group, "file": "f", "file_sha256": "0", "laser_nm": float("nan"),
        "x_unit": "cm-1", "label_note": "", "coverage": coverage,
        "diagnostic_coverage": coverage if diagnostic_coverage is None else diagnostic_coverage,
        "x_raw": [0.0], "y_raw": [0.0], "y_grid": y.astype(np.float32).tolist(),
        "extra": "{}",
    }

def _write_catalog(path):
    rng = np.random.default_rng(0)
    n = _grid_len()
    protos = {p: rng.normal(size=n) for p in ("PE", "PP", "PS", "PVC", "XX")}
    rows, i = [], 0
    for src in ("SRC_A", "SRC_B", "SRC_C"):
        for pol in ("PE", "PP", "PS"):
            for g in range(3):
                for k in range(2):
                    y = protos[pol] + 0.1 * rng.normal(size=n)
                    state = "pristine" if g == 0 else "weathered"
                    rows.append(_row(i, src, pol, f"{src}-{pol}-{g}", state, y))
                    i += 1
    for g in range(2):  # PVC only in its own source
        for k in range(2):
            rows.append(_row(i, "ONLY", "PVC", f"ONLY-{g}", "pristine",
                             protos["PVC"] + 0.1 * rng.normal(size=n)))
            i += 1
    for pol in ("UNKNOWN", "OTHER"):
        rows.append(_row(i, "SRC_A", pol, f"SRC_A-{pol}", "pristine", protos["XX"]))
        i += 1
    rows.append(_row(i, "SRC_A", "PE", "SRC_A-lowcov", "pristine", protos["PE"], coverage=0.3))
    pd.DataFrame(rows).to_parquet(path)
    return path

@pytest.fixture
def catalog(tmp_path):
    return _write_catalog(tmp_path / "spectra_catalog.parquet")

def test_evaluate_predictions_counts_no_match_as_error():
    m = evaluate_predictions(["PE", "PE", "PP", "PP"], ["PE", "NO_MATCH", "PP", "PE"])
    assert m["n"] == 4
    assert m["accuracy"] == 0.5
    assert m["coverage"] == 0.75
    assert m["per_class_recall"] == {"PE": 0.5, "PP": 0.5}
    assert m["confusion"]["PE"]["NO_MATCH"] == 1

def test_evaluation_excludes_unknown_and_other(catalog, tmp_path):
    out = tmp_path / "out"
    res = run_baseline(catalog, out)
    tech = res["techniques"]["ftir_atr"]
    assert tech["excluded"]["UNKNOWN"] == 1
    assert tech["excluded"]["OTHER"] == 1
    assert tech["excluded"]["low_coverage"] == 1
    assert tech["excluded"]["total"] == 3
    assert "UNKNOWN" not in json.dumps(tech["protocols"])
    assert '"OTHER"' not in json.dumps(tech["protocols"])
    for proto in tech["protocols"].values():
        pooled = proto.get("pooled") or proto.get("methods")
        for method in ("correlation@0", "correlation@0.7", "pca_svm"):
            assert method in pooled

def test_exclusions_are_broken_down_by_source(catalog, tmp_path):
    res = run_baseline(catalog, tmp_path / "out")
    by_src = res["techniques"]["ftir_atr"]["excluded"]["by_source"]
    assert by_src["SRC_A"] == {"UNKNOWN": 1, "OTHER": 1, "low_coverage": 1, "total": 3}
    assert by_src["SRC_B"] == {"UNKNOWN": 0, "OTHER": 0, "low_coverage": 0, "total": 0}
    assert set(by_src) == {"SRC_A", "SRC_B", "SRC_C", "ONLY"}
    text = (tmp_path / "out" / "report.md").read_text(encoding="utf-8")
    assert "Spectres exclus par source" in text
    assert "| SRC_A | 1 | 1 | 1 | 3 |" in text


def test_groups_and_loso_share_are_reported(catalog, tmp_path):
    res = run_baseline(catalog, tmp_path / "out")
    tech = res["techniques"]["ftir_atr"]
    assert tech["groups_by_source"]["SRC_A"] == 9
    assert tech["groups_by_source"]["ONLY"] == 2
    share = tech["protocols"]["loso"]["pooled_share_by_source"]
    # 54 in-library queries in total, 18 per SRC_* source; ONLY is out of library
    assert share == {"ONLY": 0.0, "SRC_A": 18 / 54, "SRC_B": 18 / 54, "SRC_C": 18 / 54}


def test_top_confusions():
    from microtrace_ml.evaluate import top_confusions
    conf = {"PE": {"PE": 5, "PP": 3, "NO_MATCH": 1}, "PP": {"PP": 4, "PE": 3}, "PS": {"PS": 2}}
    assert top_confusions(conf, k=2) == [("PE", "PP", 3), ("PP", "PE", 3)]
    assert top_confusions(conf)[-1] == ("PE", "NO_MATCH", 1)


def test_report_is_honest_about_limits(catalog, tmp_path):
    (catalog.parent / "catalog_meta.json").write_text(
        json.dumps({"git_commit": "abc1234", "git_dirty": False, "data_nature": "x"}),
        encoding="utf-8")
    run_baseline(catalog, tmp_path / "out")
    text = (tmp_path / "out" / "report.md").read_text(encoding="utf-8")
    assert "évitent toute fuite" not in text
    assert "Aucun groupe d'échantillons connu n'est partagé" in text
    assert "RaSPI = identifiant sans la lettre finale" in text
    assert "modifications non commitées : non" in text
    assert "taux de réponse" in text and "| coverage |" not in text
    assert "Principales confusions" in text
    limits = text.split("## Limites")[1]
    for needle in ("KnowItAll", "intervalle de confiance", "abstention",
                   "empreinte digitale", "SRC_A", "groupes"):
        assert needle in limits, needle


def test_loso_out_of_library_counted(catalog, tmp_path):
    res = run_baseline(catalog, tmp_path / "out")
    loso = res["techniques"]["ftir_atr"]["protocols"]["loso"]
    only = loso["per_source"]["ONLY"]["correlation@0"]
    assert only["out_of_library"] == only["n"] == 4
    assert only["accuracy"] is None
    assert "PVC" not in loso["pooled"]["correlation@0"]["per_class_recall"]
    assert loso["pooled"]["correlation@0"]["out_of_library"] == 4
    # in-library sources are classified near-perfectly on this easy synthetic data
    assert loso["pooled"]["correlation@0"]["accuracy"] > 0.95

def test_group_kfold_drops_rare_polymers(catalog, tmp_path):
    res = run_baseline(catalog, tmp_path / "out")
    gk = res["techniques"]["ftir_atr"]["protocols"]["group_kfold"]
    assert gk["excluded"]["total"] == 4  # PVC has only 2 groups
    assert gk["methods"]["pca_svm"]["n"] == 27 * 2
    assert "PVC" not in gk["methods"]["pca_svm"]["per_class_recall"]

def test_pristine_to_aged_present(catalog, tmp_path):
    res = run_baseline(catalog, tmp_path / "out")
    p2a = res["techniques"]["ftir_atr"]["protocols"]["pristine_to_aged"]
    assert p2a["methods"]["correlation@0"]["n"] > 0

def test_cli_baseline_writes_reports(catalog, tmp_path):
    out = tmp_path / "rep"
    rc = main(["baseline", "--catalog", str(catalog), "--out", str(out)])
    assert rc == 0
    assert (out / "metrics.json").exists()
    report = (out / "report.md").read_text(encoding="utf-8")
    assert "Limites" in report
    json.loads((out / "metrics.json").read_text(encoding="utf-8"))


def _strip_volatile(res):
    res = dict(res)
    res.pop("runtime_seconds", None)
    res.pop("date", None)
    return res


def _small_catalog(path, noise=False):
    rng = np.random.default_rng(1)
    n = _grid_len()
    protos = {p: rng.normal(size=n) for p in ("PE", "PP")}
    rows, i = [], 0
    for src, pols in (("A", ("PE", "PP")), ("B", ("PE",))):
        for pol in pols:
            for g in range(3):
                for _ in range(2):
                    y = protos[pol] + 0.1 * rng.normal(size=n)
                    rows.append(_row(i, src, pol, f"{src}-{pol}-{g}", "pristine", y))
                    i += 1
    if noise:
        for _ in range(4):
            rows.append(_row(i, "NOISE", "PE", f"N-{i}", "pristine", rng.normal(size=n)))
            i += 1
    pd.DataFrame(rows).to_parquet(path)
    return path


def test_pca_svm_is_deterministic(catalog, tmp_path):
    a = run_baseline(catalog, tmp_path / "a")
    b = run_baseline(catalog, tmp_path / "b")
    assert _strip_volatile(a) == _strip_volatile(b)


def test_single_class_training_fold_is_skipped_and_small_train_does_not_raise(tmp_path):
    cat = _small_catalog(tmp_path / "spectra_catalog.parquet")
    res = run_baseline(cat, tmp_path / "out")
    loso = res["techniques"]["ftir_atr"]["protocols"]["loso"]
    # holding out A leaves only PE (1 class) for training
    assert list(loso["per_source"]["A"]["pca_svm"]) == ["skipped"]
    assert "fewer than 2 classes" in loso["per_source"]["A"]["pca_svm"]["skipped"]
    # holding out B leaves 12 training rows: the component cap must keep PCA valid
    assert loso["per_source"]["B"]["pca_svm"]["n"] == 6
    pooled = loso["pooled"]["pca_svm"]
    assert len(pooled["skipped_folds"]) == 1
    report = (tmp_path / "out" / "report.md").read_text(encoding="utf-8")
    assert "Plis ignorés pour pca_svm" in report


def test_catalog_meta_is_reported(catalog, tmp_path):
    (catalog.parent / "catalog_meta.json").write_text(
        json.dumps({"git_commit": "abc1234", "data_nature": "test nature"}), encoding="utf-8"
    )
    run_baseline(catalog, tmp_path / "with")
    text = (tmp_path / "with" / "report.md").read_text(encoding="utf-8")
    assert "abc1234" in text and "test nature" in text
    (catalog.parent / "catalog_meta.json").unlink()
    res = run_baseline(catalog, tmp_path / "without")
    assert res["catalog"] == {"git_commit": "unknown", "git_dirty": "unknown",
                              "data_nature": "unknown"}
    text = (tmp_path / "without" / "report.md").read_text(encoding="utf-8")
    assert "unknown" in text


def test_report_content(catalog, tmp_path):
    run_baseline(catalog, tmp_path / "out")
    text = (tmp_path / "out" / "report.md").read_text(encoding="utf-8")
    for heading in ("## Technique : ftir_atr", "### Effectifs par source",
                    "### Effectifs par polymère", "### Leave-one-source-out (LOSO)",
                    "### Validation croisée par groupes", "### Pristine vers vieilli",
                    "## Limites"):
        assert heading in text
    assert "Rappel par polymère" in text
    assert "| SRC_A |" in text and "| PE |" in text
    assert "n_evaluated" in text
    assert "uniquement sur les requêtes présentes dans la bibliothèque" in text
    assert "{" not in text.split("## Limites")[0].split("Seuls les polymères")[1][:300]


def test_correlation_threshold_abstains_on_low_score(tmp_path):
    cat = _small_catalog(tmp_path / "spectra_catalog.parquet", noise=True)
    res = run_baseline(cat, tmp_path / "out")
    noise = res["techniques"]["ftir_atr"]["protocols"]["loso"]["per_source"]["NOISE"]
    assert noise["correlation@0"]["coverage"] >= noise["correlation@0.7"]["coverage"]
    assert noise["correlation@0.7"]["coverage"] == 0.0


def test_threshold_zero_rejected(catalog, tmp_path):
    with pytest.raises(ValueError):
        run_baseline(catalog, tmp_path / "out", threshold=0.0)


def test_fingerprint_only_row_is_kept_and_out_of_window_row_excluded(tmp_path, catalog):
    df = pd.read_parquet(catalog)
    low = df["sample_group"] == "SRC_A-lowcov"
    df.loc[low, "diagnostic_coverage"] = 1.0  # whole-grid coverage stays 0.3
    out = run_baseline(_write_df(tmp_path / "fp.parquet", df), tmp_path / "fp")
    assert out["techniques"]["ftir_atr"]["excluded"]["low_coverage"] == 0
    df.loc[low, "diagnostic_coverage"] = 0.0
    df.loc[df["sample_group"] == "SRC_B-PE-1", "coverage"] = 1.0
    out = run_baseline(_write_df(tmp_path / "ow.parquet", df), tmp_path / "ow")
    assert out["techniques"]["ftir_atr"]["excluded"]["low_coverage"] == 1


def test_old_catalog_without_diagnostic_coverage_raises(tmp_path, catalog):
    df = pd.read_parquet(catalog).drop(columns=["diagnostic_coverage"])
    with pytest.raises(ValueError, match="build-catalog"):
        run_baseline(_write_df(tmp_path / "old.parquet", df), tmp_path / "old")


def test_metrics_and_report_state_the_coverage_window(tmp_path, catalog):
    out = run_baseline(catalog, tmp_path / "rep")
    assert out["min_coverage"] == 0.8
    assert out["techniques"]["ftir_atr"]["coverage_window"] == [600.0, 1800.0]
    text = (tmp_path / "rep" / "report.md").read_text(encoding="utf-8")
    assert "fenêtre diagnostique" in text and "2 800–3 100" in text


def _write_df(path, df):
    df.to_parquet(path)
    return path
