"""Checks of the trained model i1 against the real dataset3 (skipped when absent)."""
from __future__ import annotations

import hashlib
import io
import json
import math
from collections import Counter
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from microtrace_core.imaging.dataset import build_index
from microtrace_core.imaging.model import Reason, ScaleSource, Status, analyze, load_model_bytes
from microtrace_core.imaging.reading import decode_image

pytestmark = pytest.mark.data

ROOT = Path(__file__).resolve().parents[2]
DATASET = ROOT / "datasets" / "Images" / "dataset3"
WEIGHTS = ROOT / "models" / "c6-microscopie-i1.npz"
MANIFEST = ROOT / "docs" / "models" / "c6-microscopie-manifest.json"
DATA_LIST = ROOT / "docs" / "models" / "c6-microscopie-i1-data.sha256"
LOCK = ROOT / "engine" / "src" / "microtrace_engine" / "image_model.lock.json"
FIXTURE = DATASET / "bead" / "original_image_bead" / \
    "Dove_men_acrylates_copolymer_microbeads_new_No0045.tif"
FIXTURE_SHA = "0fba33621fb3d236cff17f993776ffa4b16ce5955aa2d83c52be8af80ac85180"

if not DATASET.exists() or not WEIGHTS.exists():
    pytest.skip("datasets/Images/dataset3 or models/c6-microscopie-i1.npz not found",
                allow_module_level=True)


@pytest.fixture(scope="module")
def manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def model():
    data = WEIGHTS.read_bytes()
    assert hashlib.sha256(data).hexdigest() == json.loads(
        MANIFEST.read_text(encoding="utf-8"))["model"]["sha256"]
    return load_model_bytes(data)


@pytest.fixture(scope="module")
def items():
    return build_index(DATASET)


def test_real_index(items):
    assert len(items) == 237
    assert len({i.group for i in items}) == 218
    assert Counter(i.split for i in items) == {"train": 147, "val": 48, "test": 42}
    assert sum(i.um_per_px is not None for i in items) == 188
    assert sum(i.count is not None for i in items) == 188  # 51+41+55+41
    for i in items:
        for p in (i.image, i.label, i.tiff):
            if p is not None:
                low = p.as_posix().lower()
                assert "crop" not in low and "label_index" not in low


def test_real_weights_match_manifest(manifest):
    sha = hashlib.sha256(WEIGHTS.read_bytes()).hexdigest()
    assert sha == manifest["model"]["sha256"]
    assert sha == json.loads(LOCK.read_text(encoding="utf-8"))["sha256"]


def test_real_data_list_matches_datasets(manifest):
    lines = DATA_LIST.read_text(encoding="utf-8").splitlines()
    assert len(lines) == manifest["data"]["data_list"]["files"] > 0
    assert hashlib.sha256(DATA_LIST.read_bytes()).hexdigest() == \
        manifest["data"]["data_list"]["sha256"]
    for line in lines:
        digest, rel = line.split("  ", 1)
        got = hashlib.sha256((DATASET / rel).read_bytes()).hexdigest()
        assert got == digest, rel


def test_real_e2e_image(model):
    data = FIXTURE.read_bytes()
    assert len(data) == 1230494 and hashlib.sha256(data).hexdigest() == FIXTURE_SHA
    d = decode_image(data)
    res = analyze(model, d, None)
    assert res.scale.source is ScaleSource.METADATA
    assert res.scale.um_per_px_input == pytest.approx(0.7632211)
    assert d.cropped_bottom_px == 60
    assert res.analysis_size == (1024, 720)
    assert res.status is Status.PROPOSAL, res.reasons
    assert 1 <= res.count <= 2
    biggest = max(p.particle.eq_diameter_px for p in res.particles)
    assert 240 <= biggest * res.scale.um_per_px_analysis <= 340


def test_real_uniform_image_abstains(model):
    buf = io.BytesIO()
    Image.fromarray(np.full((768, 1024), 128, dtype=np.uint8)).save(buf, "PNG")
    res = analyze(model, decode_image(buf.getvalue()), None)
    assert res.status is Status.UNRELIABLE
    assert Reason.NO_PARTICLE in res.reasons
    assert res.count == 0 and not math.isnan(res.foreground)
