import json

import numpy as np
import pandas as pd
import pytest

from microtrace_core.preprocess import GRIDS
from microtrace_ml.cli import main
from microtrace_ml.evaluate import evaluate_predictions, run_baseline


def _grid_len():
    return len(GRIDS["ftir_atr"])


def _row(i, src, polymer, group, state, y, coverage=1.0):
    return {
        "spectrum_id": f"{src}:{i}", "source": src, "technique": "ftir_atr",
        "polymer": polymer, "polymer_raw": polymer, "state": state,
        "sample_group": group, "file": "f", "file_sha256": "0", "laser_nm": float("nan"),
        "x_unit": "cm-1", "label_note": "", "coverage": coverage,
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
    text = json.dumps(res)
    assert "UNKNOWN" not in json.dumps(tech["protocols"])
    assert '"OTHER"' not in json.dumps(tech["protocols"])
    for proto in tech["protocols"].values():
        pooled = proto.get("pooled") or proto.get("methods")
        for method in ("correlation@0", "correlation@0.7", "pca_svm"):
            assert method in pooled
    assert text

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
