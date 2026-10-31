"""Checks of the trained model s1 against the real datasets (skipped when absent)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from microtrace_core.catalog import load_catalog
from microtrace_core.spectral.archive import load_model_bytes
from microtrace_core.spectral.model import Abstention, SpectralQuery, Status, identify
from microtrace_core.spectral.reading import parse_two_columns

pytestmark = pytest.mark.data

ROOT = Path(__file__).resolve().parents[2]
DATASETS = ROOT / "datasets"
WEIGHTS = ROOT / "models" / "c5-spectral-s1.npz"
MANIFEST = ROOT / "docs" / "models" / "c5-spectral-manifest.json"
DATA_LIST = ROOT / "docs" / "models" / "c5-spectral-s1-data.sha256"
CATALOG = ROOT / "data" / "processed" / "spectra_catalog.parquet"
FIXTURE = DATASETS / "Spectres" / "10.22000-1820" / "data" / "dataset" / \
    "VLFR_02-HDPE_nobio_Raman_dc1c0b0b.csv"
FIXTURE_SHA = "36d2f382b66b680d8d204ab900ac0fbb6d8a93ae6bbea6495ba95dc22e57ce19"

if not (DATASETS / "Spectres").exists() or not WEIGHTS.exists():
    pytest.skip("datasets/Spectres or models/c5-spectral-s1.npz not found", allow_module_level=True)


@pytest.fixture(scope="module")
def manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def model():
    data = WEIGHTS.read_bytes()
    assert hashlib.sha256(data).hexdigest() == json.loads(
        MANIFEST.read_text(encoding="utf-8"))["model"]["sha256"]
    return load_model_bytes(data)


def test_real_weights_match_manifest(manifest):
    assert hashlib.sha256(WEIGHTS.read_bytes()).hexdigest() == manifest["model"]["sha256"]


def test_real_data_list_matches_datasets(manifest):
    lines = DATA_LIST.read_text(encoding="utf-8").splitlines()
    assert len(lines) == manifest["data"]["data_list"]["files"] > 0
    for line in lines:
        digest, rel = line.split("  ", 1)
        got = hashlib.sha256((DATASETS / rel).read_bytes()).hexdigest()
        assert got == digest, rel


def test_real_e2e_fixture_identified_pe(model):
    data = FIXTURE.read_bytes()
    assert hashlib.sha256(data).hexdigest() == FIXTURE_SHA
    x, y = parse_two_columns(data)
    res = identify(model, SpectralQuery(x=x, y=y, technique="raman", x_unit="nm",
                                        y_unit="intensity", laser_nm=532.0))
    assert res.status == Status.IDENTIFIED
    assert res.candidates[0].polymer == "PE"
    assert res.references[0].spectrum_id == "mpx:VLFR_02-HDPE_nobio_Raman_dc1c0b0b"
    assert res.references[0].score > 0.9999
    assert res.references[0].curve is not None


def test_real_e2e_noise_abstains(model):
    i = np.arange(1000)
    x = 200.0 + 3.0 * i
    y = ((i * 7919) % 1000) / 1000.0
    res = identify(model, SpectralQuery(x=x, y=y, technique="raman", x_unit="cm-1",
                                        y_unit="intensity", laser_nm=785.0))
    assert res.status == Status.NOT_IDENTIFIED
    assert res.abstention == Abstention.LOW_SCORE
    assert res.candidates[0].score < 0.2


def test_real_wrong_laser_abstains(model):
    df = load_catalog(CATALOG)
    sel = df[(df.source == "mpx") & (df.technique == "raman") & (df.x_unit == "nm")
             & (df.laser_nm == 532.0)].sample(100, random_state=0)
    assert len(sel) == 100
    for row in sel.itertuples():
        res = identify(model, SpectralQuery(
            x=np.asarray(row.x_raw, dtype=float), y=np.asarray(row.y_raw, dtype=float),
            technique="raman", x_unit="nm", y_unit="intensity", laser_nm=785.0))
        assert res.status == Status.NOT_IDENTIFIED
        assert res.abstention == Abstention.LOW_COVERAGE, row.spectrum_id


def test_real_wrong_technique_metrics(manifest):
    """R-C5-3: full population; a wrong "identifié" is the safety-relevant outcome."""
    floors = {"ftir_atr": 0.80, "raman": 0.90}
    for t, floor in floors.items():
        w = manifest["metrics"][t]["wrong_technique"]
        assert w["not_identified"] >= floor, t
        assert w["identified"] <= 0.02, t
