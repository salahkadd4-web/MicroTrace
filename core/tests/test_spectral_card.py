"""The versioned model card must match the versioned manifest (not marked data)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from microtrace_core.spectral.train import BEGIN_MARKER, END_MARKER, render_card_metrics

ROOT = Path(__file__).resolve().parents[2]
CARD = ROOT / "docs" / "models" / "c5-spectral.md"
MANIFEST = ROOT / "docs" / "models" / "c5-spectral-manifest.json"


def _manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def test_card_metrics_block_is_current():
    text = CARD.read_text(encoding="utf-8")
    i, j = text.index(BEGIN_MARKER), text.index(END_MARKER)
    block = text[i + len(BEGIN_MARKER): j].strip("\n")
    assert block == render_card_metrics(_manifest()).strip("\n")


def test_card_states_trial_status_and_hashes():
    text = CARD.read_text(encoding="utf-8")
    lowered = text.lower()
    for phrase in ("Modèle d'essai", "pas de classe non plastique dans cette version",
                   "n'a pas vu de particules extraites de sang",
                   "entraîné sur des données publiques, pas encore sur les vôtres"):
        assert phrase.lower() in lowered, phrase
    assert hashlib.sha256(MANIFEST.read_bytes()).hexdigest() in text
    assert _manifest()["model"]["sha256"] in text
    assert "{{" not in text
