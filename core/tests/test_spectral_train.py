from __future__ import annotations

import copy
import json

import numpy as np
import pytest
from spectral_fixtures import make_catalog

from microtrace_core import cli
from microtrace_core.spectral import train as tr
from microtrace_core.spectral.model import pca_transform, window_mask
from microtrace_core.spectral.thresholds import (
    LoloPrediction,
    NoThresholds,
    Thresholds,
    choose_thresholds,
)


@pytest.fixture(scope="module")
def df():
    return make_catalog()


def baseline_for(df, delta=0.0):
    return {"techniques": {t: {"protocols": {"loso": {"pooled": {"correlation@0": {
        "accuracy": tr.baseline_correlation(df, t) + delta}}}}} for t in tr.TECHNIQUES}}


def frames(df):
    return {t: tr.training_frame(df, t) for t in tr.TECHNIQUES}


def test_training_frame_filters_unknown_other_and_low_coverage(df):
    d = df.copy()
    d.loc[0, "polymer"] = "UNKNOWN"
    d.loc[1, "polymer"] = "OTHER"
    d.loc[2, "diagnostic_coverage"] = 0.5
    kept = tr.training_frame(d, "ftir_atr")
    assert len(kept) == len(tr.training_frame(df, "ftir_atr")) - 3
    assert set(kept["technique"]) == {"ftir_atr"}


def test_lolo_never_trains_on_held_library(df, monkeypatch):
    f = frames(df)
    fits, guards = [], []
    real_fit, real_guard = tr.fit_technique, tr.guard_reference

    def spy_fit(df_t, technique, thresholds, **kw):
        fits.append((technique, set(df_t["source"]), set(df_t["spectrum_id"])))
        return real_fit(df_t, technique, thresholds, **kw)

    def spy_guard(other, held):
        out = real_guard(other, held)
        guards.append((held, set(out["source"]), set(out["spectrum_id"])))
        return out

    monkeypatch.setattr(tr, "fit_technique", spy_fit)
    monkeypatch.setattr(tr, "guard_reference", spy_guard)
    preds = tr.lolo_predictions(f["raman"], "raman", f["ftir_atr"])
    assert {p.library for p in preds} == {"mpx", "slopp"}
    held_ids = {lib: set(f["raman"][f["raman"]["source"] == lib]["spectrum_id"])
                for lib in ("mpx", "slopp")}
    other_ids = {lib: set(f["ftir_atr"][f["ftir_atr"]["source"] == lib]["spectrum_id"])
                 for lib in ("mpx", "flopp")}
    assert len(fits) == 2 and len(guards) == 2
    for technique, sources, ids in fits:
        assert technique == "raman" and len(sources) == 1
        (held,) = {"mpx", "slopp"} - sources
        assert not ids & held_ids[held]
    for held, sources, ids in guards:
        assert held not in sources
        assert not ids & other_ids.get(held, set())  # mpx is held in both techniques


def test_lolo_predictions_are_correct_on_synthetic_data(df):
    f = frames(df)
    preds = tr.lolo_predictions(f["ftir_atr"], "ftir_atr", f["raman"])
    assert len(preds) == len(f["ftir_atr"])
    assert all(p.in_library and p.top[0] == p.true and p.classifier == p.true for p in preds)
    assert all(p.other_score is not None and p.other_coverage >= 0.8 for p in preds)


def test_nested_selection_excludes_evaluated_library(df, monkeypatch):
    f = frames(df)
    preds = tr.lolo_predictions(f["ftir_atr"], "ftir_atr", f["raman"])
    calls = []

    def spy(sel):
        calls.append({p.library for p in sel})
        return choose_thresholds(sel)

    monkeypatch.setattr(tr, "choose_thresholds", spy)
    result = tr.nested_precision(preds)
    assert sorted(result) == ["flopp", "mpx"]
    assert sorted(calls, key=sorted) == [{"flopp"}, {"mpx"}]  # each call lacks one library
    assert all(0.0 <= v <= 1.0 for v in result.values())


def test_baseline_reproduction_gate(df):
    out = tr.reproduce_baseline(df, baseline_for(df, 0.004))
    assert all(abs(r["delta"]) < 0.005 for r in out.values())
    with pytest.raises(tr.BaselineMismatch):
        tr.reproduce_baseline(df, baseline_for(df, 0.01))


def run(tmp_path, df, name="run", baseline=None, **kw):
    cat = tmp_path / "catalog" / "spectra_catalog.parquet"
    if not cat.exists():
        cat.parent.mkdir(parents=True)
        df.to_parquet(cat)
    base = tmp_path / "baseline.json"
    base.write_text(json.dumps(baseline or baseline_for(df)))
    out = tmp_path / name
    args = dict(catalog=cat, baseline=base, models_dir=out / "models",
                manifest=out / "manifest.json", data_list=out / "data.sha256",
                lock=out / "lock.json", card=None)
    args.update(kw)
    return args, tr.run_training(**args)


def test_training_is_deterministic(tmp_path, df):
    a, code_a = run(tmp_path, df, "one")
    b, code_b = run(tmp_path, df, "two")
    assert code_a == code_b == 0
    ma = json.loads(a["manifest"].read_text())
    mb = json.loads(b["manifest"].read_text())
    assert ma["model"]["sha256"] == mb["model"]["sha256"]
    assert (a["models_dir"] / tr.MODEL_FILE).read_bytes() == (b["models_dir"] / tr.MODEL_FILE).read_bytes()
    assert json.loads(a["lock"].read_text())["sha256"] == ma["model"]["sha256"]
    assert ma["thresholds"]["ftir_atr"]["identified_min_score"] > 0
    lines = a["data_list"].read_text().splitlines()
    assert lines and all(len(line.split("  ")[0]) == 64 for line in lines)


def test_numpy_svm_checked_on_training_set(tmp_path, df, monkeypatch):
    monkeypatch.setattr(tr, "svm_predict", lambda p, Z: np.repeat(p.classes[:1], len(Z)))
    with pytest.raises(RuntimeError, match="differs"):
        run(tmp_path, df)
    assert not (tmp_path / "run").exists()


def test_cli_train_spectral_exit_codes(tmp_path, df):
    cat = tmp_path / "catalog" / "spectra_catalog.parquet"
    cat.parent.mkdir()
    df.to_parquet(cat)

    def argv(name, baseline, *extra):
        base = tmp_path / f"{name}.baseline.json"
        base.write_text(json.dumps(baseline))
        out = tmp_path / name
        return ["train-spectral", "--catalog", str(cat), "--baseline", str(base),
                "--models", str(out / "models"), "--manifest", str(out / "manifest.json"),
                "--data-list", str(out / "data.sha256"), "--lock", str(out / "lock.json"),
                *extra]

    assert cli.main(argv("bad", baseline_for(df, 0.01))) == 3
    assert not (tmp_path / "bad").exists()

    good = baseline_for(df)
    assert cli.main(argv("ok", good)) == 0
    assert cli.main(argv("ok", good, "--check")) == 0
    manifest = tmp_path / "ok" / "manifest.json"
    data = json.loads(manifest.read_text())
    data["model"]["sha256"] = "0" * 64
    manifest.write_text(json.dumps(data))
    assert cli.main(argv("ok", good, "--check")) == 4
    assert json.loads(manifest.read_text())["model"]["sha256"] == "0" * 64  # check writes nothing


def test_train_returns_exit_5_without_thresholds(tmp_path, df, monkeypatch):
    def refuse(preds):
        raise NoThresholds("none")

    monkeypatch.setattr(tr, "choose_thresholds", refuse)
    _, code = run(tmp_path, df)
    assert code == 5 and not (tmp_path / "run").exists()


def test_metrics_publish_abstention_shares(df):
    model, body = tr.train(df, baseline_for(df))
    for t in ("ftir_atr", "raman"):
        g = body["metrics"][t]["global"]
        assert g["top1"] == 1.0 and g["status_in_library"]["identified"] > 0.9
        assert body["metrics"][t]["wrong_technique"]["not_identified"] is not None
        assert "per_library" in body["metrics"][t]
    assert json.loads(json.dumps(body)) and "trained_at" not in body
    assert "git_commit" not in json.dumps(body)
    assert model.techniques["raman"].thresholds.uncertain_min_score >= 0.5


CARD = "# Fiche\r\nAvant  \n\n<!-- BEGIN:metrics -->\nancien\n<!-- END:metrics -->\n\nAprès é\r\n"


def test_render_card_metrics_replaces_block_only(df):
    _, body = tr.train(df, baseline_for(df))
    block = tr.render_card_metrics(body)
    assert "ftir_atr" in block and "|" in block
    new = tr.replace_metrics_block(CARD, block)
    head, tail = CARD.split(tr.BEGIN_MARKER)[0], CARD.split(tr.END_MARKER)[1]
    assert new.startswith(head + tr.BEGIN_MARKER) and new.endswith(tr.END_MARKER + tail)
    assert "ancien" not in new
    assert tr.replace_metrics_block(new, block) == new  # idempotent
    with pytest.raises(ValueError):
        tr.replace_metrics_block("no markers", block)


def test_run_training_writes_the_card_block(tmp_path, df):
    card = tmp_path / "card.md"
    card.write_bytes(CARD.encode("utf-8"))
    _, code = run(tmp_path, df, card=card)
    assert code == 0
    raw = card.read_bytes().decode("utf-8")
    assert raw.startswith("# Fiche\r\nAvant  \n\n<!-- BEGIN:metrics -->")
    assert raw.endswith("<!-- END:metrics -->\n\nAprès é\r\n") and "ancien" not in raw


def test_baseline_helper_does_not_mutate_input(df):
    before = copy.deepcopy(baseline_for(df))
    tr.reproduce_baseline(df, before)
    assert before == baseline_for(df)


def test_leakage_spy_covers_wrong_technique_predictions(df, monkeypatch):
    f = frames(df)
    fits, guards = [], []
    real_fit, real_guard = tr.fit_technique, tr.guard_reference

    def spy_fit(df_t, technique, thresholds, **kw):
        fits.append((technique, set(df_t["source"])))
        return real_fit(df_t, technique, thresholds, **kw)

    def spy_guard(other, held):
        out = real_guard(other, held)
        guards.append((held, set(out["source"])))
        return out

    monkeypatch.setattr(tr, "fit_technique", spy_fit)
    monkeypatch.setattr(tr, "guard_reference", spy_guard)
    preds = tr.wrong_technique_predictions(f["raman"], "raman", f["ftir_atr"])
    assert preds and {p.library for p in preds} == {"mpx", "slopp"}
    # raman queries are read as ftir: the ftir fold never holds the query's library (mpx is in both)
    assert sorted(held for held, _ in guards) == ["mpx", "slopp"] * 2 or len(guards) >= 4
    for held, sources in guards:
        assert held not in sources
    assert len(fits) == 2 and all(t == "ftir_atr" for t, _ in fits)
    assert {frozenset(src) for _, src in fits} == {frozenset({"flopp"}), frozenset({"flopp", "mpx"})}


def test_gamma_scale_equals_sklearn_on_fold_data(df):
    from sklearn.svm import SVC

    d = tr.training_frame(df, "raman")
    d = d[d["source"] != "slopp"].reset_index(drop=True)  # a fold's training data
    tm = tr.fit_technique(d, "raman", None)
    Z = pca_transform(tm.pca_mean, tm.pca_components, tm.refs)
    ref = SVC(kernel="rbf", gamma="scale").fit(Z, tm.labels)
    assert tm.svm.gamma == pytest.approx(ref._gamma, rel=1e-12)
    assert tm.refs.shape[1] == int(window_mask("raman").sum())


def _lp(lib, top, other_score=None):
    return LoloPrediction(lib, "X", True, tuple(top), (0.90, 0.80), top[0], 1.0,
                          other_score, None if other_score is None else 1.0)


def test_nested_precision_applies_the_technique_guard_and_reports_gaps():
    preds = [_lp("a", ["X", "Y"]) for _ in range(50)]
    preds += [_lp("b", ["X", "Y"]) for _ in range(50)]
    preds += [_lp("b", ["Y", "X"], other_score=1.0) for _ in range(3)]  # wrong, guard fires
    t_other = Thresholds(0.5, 0.7, 0.05)
    guarded = tr.nested_precision(preds, t_other)
    unguarded = tr.nested_precision(preds)
    assert guarded["b"] == 1.0 and unguarded["b"] < 1.0
    # library a: thresholds cannot be chosen on b alone (precision 50/53): reported, not dropped
    assert "a" in guarded and guarded["a"] is None


def test_card_without_markers_fails_before_any_write(tmp_path, df):
    card = tmp_path / "card.md"
    card.write_text("no markers here", encoding="utf-8")
    with pytest.raises(ValueError):
        run(tmp_path, df, card=card)
    assert not (tmp_path / "run").exists()
    assert card.read_text(encoding="utf-8") == "no markers here"


def test_manifest_paths_are_not_absolute(tmp_path, df, monkeypatch):
    monkeypatch.chdir(tmp_path)
    a, code = run(tmp_path, df)
    assert code == 0
    path = json.loads(a["manifest"].read_text())["data"]["data_list"]["path"]
    assert path == "run/data.sha256"
