"""Training command on the miniature dataset: no leak, deterministic, checked, exit codes."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from microtrace_core import archive as core_archive
from microtrace_core import cli
from microtrace_core.imaging import train as tr
from microtrace_core.imaging.dataset import build_index
from microtrace_core.imaging.model import load_model_bytes
from microtrace_core.spectral import archive as spectral_archive

from imaging_fixtures import write_mini_dataset

EXPECTED = 18
CARD = ("# Fiche\r\nAvant  \n\n<!-- BEGIN:metrics -->\nancien bloc\n<!-- END:metrics -->\n\n"
        "Après é\r\n")


@pytest.fixture(scope="module")
def dataset(tmp_path_factory) -> Path:
    return write_mini_dataset(tmp_path_factory.mktemp("dataset3"))


def _paths(base: Path) -> dict:
    return dict(models_dir=base / "models", manifest=base / "docs" / "manifest.json",
                data_list=base / "docs" / "data.sha256", lock=base / "engine" / "image.lock.json")


def _run(dataset: Path, base: Path, **kw) -> int:
    return tr.run_training(dataset=dataset, expected_images=EXPECTED, **_paths(base), **{
        "card": None, **kw})


@pytest.fixture(scope="module")
def first_run(dataset, tmp_path_factory):
    base = tmp_path_factory.mktemp("run1")
    card = base / "card.md"
    card.write_bytes(CARD.encode("utf-8"))
    code = _run(dataset, base, card=card)
    return base, code, card


def test_archive_moved_without_change():
    assert spectral_archive.write_archive is core_archive.write_archive
    assert spectral_archive.read_archive is core_archive.read_archive
    assert spectral_archive.archive_bytes is core_archive.archive_bytes
    assert spectral_archive.FIXED_DATE == core_archive.FIXED_DATE == (1980, 1, 1, 0, 0, 0)


def test_first_run_writes_everything(first_run):
    base, code, card = first_run
    assert code == 0
    p = _paths(base)
    npz = p["models_dir"] / tr.MODEL_FILE
    assert tr.MODEL_FILE == "c6-microscopie-i1.npz" and npz.stat().st_size < 50 * 1024 * 1024
    man = json.loads(p["manifest"].read_text("utf-8"))
    lock = json.loads(p["lock"].read_text("utf-8"))
    sha = hashlib.sha256(npz.read_bytes()).hexdigest()
    assert man["model"] == {"name": "c6-microscopie", "version": "i1", "file": tr.MODEL_FILE,
                            "sha256": sha, "size_bytes": npz.stat().st_size}
    assert lock == {"name": "c6-microscopie", "version": "i1", "file": tr.MODEL_FILE, "sha256": sha}
    model = load_model_bytes(npz.read_bytes())
    assert model.version == "i1" and model.shape.classes == ("bille", "fibre", "fragment") or \
        set(model.shape.classes) == {"fibre", "fragment", "bille"}
    # the data list: one line per image, mask, counts file and matching TIFF; no sidecar
    lines = p["data_list"].read_text("utf-8").splitlines()
    assert lines == sorted(lines) and len(lines) == 18 + 18 + 3 + 17
    assert all(not ln.endswith(".txt") or "counts_" in ln for ln in lines)
    assert man["data"]["data_list"]["sha256"] == hashlib.sha256(
        p["data_list"].read_bytes()).hexdigest()
    assert man["data"]["images"] == 18 and sum(man["data"]["by_split"].values()) == 18
    for blob in (p["manifest"].read_bytes(), p["data_list"].read_bytes(), npz.read_bytes()):
        assert b"Dupont" not in blob and b"PC-SEM" not in blob


def test_manifest_is_complete_and_relative(first_run):
    base, _, _ = first_run
    man = json.loads(_paths(base)["manifest"].read_text("utf-8"))
    for key in ("model", "trained_at", "code", "data", "params", "selection", "metrics",
                "baseline_otsu"):
        assert key in man
    assert set(man["code"]) >= {"git_commit", "numpy", "scipy", "scikit-learn", "scikit-image",
                                "Pillow", "python"}
    text = json.dumps(man)
    assert str(base) not in text and "C:\\" not in text and "C:/" not in text
    sel = man["selection"]
    assert sel["pixel_threshold"] in (0.5, 0.6, 0.7, 0.8)
    assert sel["min_area_frac"] in (0.0005, 0.001, 0.002, 0.005, 0.01)
    assert sel["shape_min_score"] in (0.5, 0.6, 0.7, 0.8)
    assert sel["max_foreground"] in (0.2, 0.25, 0.3, 0.4)
    metrics = man["metrics"]
    assert metrics["n_images"] == man["data"]["by_split"]["test"]
    assert "global" in metrics and "by_subset" in metrics and "abstention" in metrics
    assert "shape_rules" in metrics and "shape_components" in metrics
    # groups and sides are listed, none on both sides
    sides = {}
    for g in man["data"]["groups"]:
        sides.setdefault(g["group"], set()).add(g["split"])
    assert all(len(s) == 1 for s in sides.values())


def test_training_never_sees_test(dataset, monkeypatch):
    seen = {"fit_forest": [], "fit_shape": [], "choose_settings": [], "order": []}
    orig = (tr.fit_forest, tr.fit_shape, tr.choose_settings, tr.evaluate_split)

    def spy_forest(items, *a, **k):
        seen["fit_forest"].append({i.split for i in items})
        seen["order"].append("fit_forest")
        return orig[0](items, *a, **k)

    def spy_shape(items, *a, **k):
        seen["fit_shape"].append({i.split for i in items})
        return orig[1](items, *a, **k)

    def spy_choose(forest, shape, val, *a, **k):
        seen["choose_settings"].append({i.split for i in val})
        seen["order"].append("choose_settings")
        return orig[2](forest, shape, val, *a, **k)

    def spy_eval(items, *a, **k):
        seen["order"].append("evaluate:" + ",".join(sorted({i.split for i in items})))
        return orig[3](items, *a, **k)

    monkeypatch.setattr(tr, "fit_forest", spy_forest)
    monkeypatch.setattr(tr, "fit_shape", spy_shape)
    monkeypatch.setattr(tr, "choose_settings", spy_choose)
    monkeypatch.setattr(tr, "evaluate_split", spy_eval)
    model, body = tr.train(dataset)
    assert seen["fit_forest"] == [{"train"}, {"train", "val"}]
    assert seen["fit_shape"] == [{"train"}, {"train", "val"}]
    assert seen["choose_settings"] == [{"val"}]
    evals = [o for o in seen["order"] if o.startswith("evaluate")]
    assert evals and all(o == "evaluate:test" for o in evals)
    # the test is evaluated only after the settings are chosen and the final forest is fitted
    last_fit = max(i for i, o in enumerate(seen["order"]) if o == "fit_forest")
    assert min(i for i, o in enumerate(seen["order"]) if o.startswith("evaluate")) > last_fit
    assert body["data"]["by_split"]["test"] > 0 and model.version == "i1"


def test_training_is_deterministic(dataset, first_run, tmp_path):
    base, _, _ = first_run
    assert _run(dataset, tmp_path) == 0
    a = (base / "models" / tr.MODEL_FILE).read_bytes()
    b = (tmp_path / "models" / tr.MODEL_FILE).read_bytes()
    assert hashlib.sha256(a).hexdigest() == hashlib.sha256(b).hexdigest()
    ma = json.loads(_paths(base)["manifest"].read_text("utf-8"))
    mb = json.loads(_paths(tmp_path)["manifest"].read_text("utf-8"))
    assert ma["metrics"] == mb["metrics"] and ma["selection"] == mb["selection"]


def test_numpy_forest_checked(dataset, tmp_path, monkeypatch):
    from microtrace_core.imaging import forest as forest_mod

    real = forest_mod.forest_proba
    monkeypatch.setattr(forest_mod, "forest_proba",
                        lambda f, X: (real(f, X) + np.float32(0.01)).astype(np.float32))
    assert _run(dataset, tmp_path) == 6
    assert not any(tmp_path.rglob("*.npz")) and not _paths(tmp_path)["manifest"].exists()
    assert not _paths(tmp_path)["lock"].exists() and not _paths(tmp_path)["data_list"].exists()


def test_cli_exit_codes(dataset, first_run, tmp_path):
    base, _, _ = first_run
    p = _paths(base)
    args = ["train-image", "--dataset", str(dataset), "--models", str(p["models_dir"]),
            "--manifest", str(p["manifest"]), "--data-list", str(p["data_list"]),
            "--lock", str(p["lock"]), "--expected-images", str(EXPECTED)]
    assert cli.main(args + ["--check"]) == 0

    # a photo missing: 17 images where 18 are expected
    short = write_mini_dataset(tmp_path / "short", drop_last_image=True)
    assert len(build_index(short)) == 17
    assert _run(short, tmp_path / "out_short") == 3
    assert not (tmp_path / "out_short" / "models").exists()

    # the recorded hash no longer matches
    man = json.loads(p["manifest"].read_text("utf-8"))
    broken = tmp_path / "manifest.json"
    man["model"]["sha256"] = "0" * 64
    broken.write_text(json.dumps(man), "utf-8")
    swapped = [broken.as_posix() if a == str(p["manifest"]) else a for a in args]
    assert cli.main(swapped + ["--check"]) == 4


def test_no_settings_gives_exit_5(dataset, tmp_path, monkeypatch):
    def refuse(*a, **k):
        raise tr.NoSettings("no setting satisfies the criteria")

    monkeypatch.setattr(tr, "choose_settings", refuse)
    assert _run(dataset, tmp_path) == 5
    assert not any(tmp_path.rglob("*.npz"))


def test_render_card_metrics_replaces_block_only(first_run):
    base, _, card = first_run
    man = json.loads(_paths(base)["manifest"].read_text("utf-8"))
    block = tr.render_card_metrics(man)
    assert "|" in block and "Otsu" in block and "0." not in block.replace("0.0.", "")
    new = tr.replace_metrics_block(CARD, block)
    head, tail = CARD.split(tr.BEGIN_MARKER)[0], CARD.split(tr.END_MARKER)[1]
    assert new.startswith(head + tr.BEGIN_MARKER) and new.endswith(tr.END_MARKER + tail)
    assert "ancien" not in new
    assert tr.replace_metrics_block(new, block) == new
    with pytest.raises(ValueError):
        tr.replace_metrics_block("no markers", block)
    # run_training wrote exactly that block, leaving the rest byte for byte
    raw = card.read_bytes().decode("utf-8")
    assert raw.startswith("# Fiche\r\nAvant  \n\n<!-- BEGIN:metrics -->")
    assert raw.endswith("<!-- END:metrics -->\n\nAprès é\r\n") and "ancien" not in raw
    assert raw == tr.replace_metrics_block(CARD, block)


def test_card_without_markers_fails_before_any_write(dataset, tmp_path):
    card = tmp_path / "card.md"
    card.write_text("no markers here", "utf-8")
    with pytest.raises(ValueError):
        _run(dataset, tmp_path, card=card)
    assert not any(tmp_path.rglob("*.npz")) and not _paths(tmp_path)["manifest"].exists()


def test_otsu_baseline_finds_bright_blobs():
    from imaging_fixtures import discs_image

    gray = discs_image(256, 256, [(70, 70, 30), (180, 180, 25)], bg=40, fg=210)
    labels = tr.otsu_baseline(gray, 0.002)
    assert labels.max() == 2
    dark = 255 - gray  # dark blobs on a light background: polarity is chosen automatically
    assert tr.otsu_baseline(dark, 0.002).max() == 2


def test_cli_image_eval_scores_polygon_predictions(dataset, tmp_path, capsys):
    items = [i for i in build_index(dataset) if i.split == "test"]
    from microtrace_core.imaging.dataset import load_mask
    from skimage import measure

    preds = {}
    for it in items:  # the reference contours themselves, as polygons of [x, y]
        mask = load_mask(it.label)
        preds[it.image.relative_to(dataset).as_posix()] = [
            [[float(x), float(y)] for y, x in c] for c in measure.find_contours(
                np.pad(mask.astype(float), 1), 0.5) if len(c) > 8]
    path = tmp_path / "preds.json"
    path.write_text(json.dumps(preds), "utf-8")
    code = cli.main(["image-eval", "--dataset", str(dataset), "--predictions", str(path),
                     "--min-area-frac", "0.001"])
    out = json.loads(capsys.readouterr().out)
    assert code == 0 and out["n_images"] == len(items) and out["n_without_prediction"] == 0
    assert out["global"]["objects"]["recall"] > 0.8 and "per_image" not in out
    path.write_text("{}", "utf-8")
    cli.main(["image-eval", "--dataset", str(dataset), "--predictions", str(path)])
    empty = json.loads(capsys.readouterr().out)
    assert empty["n_without_prediction"] == len(items) and empty["global"]["objects"]["tp"] == 0
