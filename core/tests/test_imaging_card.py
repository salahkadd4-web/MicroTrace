"""The versioned image-model card must match the versioned manifest (not marked data)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from microtrace_core.imaging.train import BEGIN_MARKER, END_MARKER, render_card_metrics

ROOT = Path(__file__).resolve().parents[2]
CARD = ROOT / "docs" / "models" / "c6-microscopie.md"
MANIFEST = ROOT / "docs" / "models" / "c6-microscopie-manifest.json"
LOCK = ROOT / "engine" / "src" / "microtrace_engine" / "image_model.lock.json"


def _manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def test_card_metrics_block_is_current():
    text = CARD.read_text(encoding="utf-8")
    i, j = text.index(BEGIN_MARKER), text.index(END_MARKER)
    block = text[i + len(BEGIN_MARKER): j].strip("\n")
    assert block == render_card_metrics(_manifest()).strip("\n")


def test_card_states_status_data_and_hashes():
    text = CARD.read_text(encoding="utf-8")
    lowered = text.lower()
    for phrase in ("Modèle d'essai", "particules candidates", "film", "non évaluée",
                   "licence à confirmer", "Roboflow",
                   "entraîné et évalué sur des images MEB seulement"):
        assert phrase.lower() in lowered, phrase
    assert hashlib.sha256(MANIFEST.read_bytes()).hexdigest() in text
    sha = _manifest()["model"]["sha256"]
    assert sha in text
    assert json.loads(LOCK.read_text(encoding="utf-8"))["sha256"] == sha
    assert "{{" not in text and "\r" not in text


def test_manifest_provenance():
    man = _manifest()
    assert man["code"]["git_dirty"] is False
    assert len(man["code"]["git_commit"]) == 40
    assert man["code"]["git_commit"][:12] in CARD.read_text(encoding="utf-8")
    assert man["params"]["seed"] == 0
    assert man["data"]["data_list"]["files"] > 0


def test_card_figures_come_from_the_manifest():
    text = CARD.read_text(encoding="utf-8")
    man = _manifest()
    ab = man["metrics"]["abstention"]
    assert f"{ab['unreliable']} images « non fiable » sur {ab['n_images']} au test" in text
    assert str(man["data"]["images"]) in text and str(man["data"]["n_groups"]) in text
    s = man["selection"]["settings"]
    assert 0 < s["scale_min"] < s["scale_max"]
    # weakly evaluated subsets are named
    for name in ("fibre_2", "fragment_2", "fibre_1", "bead"):
        assert name in text
