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


def test_card_licence_statuses():
    text = CARD.read_text(encoding="utf-8")
    rows = [ln for ln in text.splitlines() if ln.startswith("| `")]
    pending = [ln for ln in rows if "| à compléter |" in ln]
    # flopp+flopp_e, slopp+slopp_e, raspi, raman_weathered: six libraries, four table rows or fewer
    assert sum(ln.count("`") // 2 for ln in pending) == 6
    mpx = [ln for ln in rows if ln.startswith("| `mpx`")]
    assert len(mpx) == 1 and "CC BY-SA 4.0" in mpx[0] and "oui" in mpx[0]
    assert "licences doivent être confirmées avant toute présentation" in text


def test_card_figures_come_from_the_manifest():
    """Wrong-technique and guard figures are rendered from the manifest; bounds hold (R-C5-3).

    The same bound is also asserted in test_spectral_real.py, which is marked `data` and
    skipped without the weights; this copy runs everywhere.
    """
    text = CARD.read_text(encoding="utf-8")
    man = _manifest()
    for t, floor in (("ftir_atr", 0.80), ("raman", 0.90)):
        w = man["metrics"][t]["wrong_technique"]
        assert w["not_identified"] >= floor and w["identified"] <= 0.02, t
        assert man["metrics"][t]["global"]["status_in_library"]["technique_mismatch"] <= 0.05, t
    assert "Faux signalements de la garde" in text and "respectée" in text
    assert "Part de MicroPlastiX" in text
    prose = text.split(END_MARKER, 1)[1]
    assert "199 sur 200" in prose  # explained as another protocol, not a sample
    assert "échantillon aléatoire" not in text
    assert "axe en nm" in prose and "ne le couvre pas" in prose


def test_card_block_uses_decimal_commas_and_names_unevaluated_polymers():
    man = _manifest()
    block = render_card_metrics(man)
    assert "Seuils : incertain dès 0,5, identifié dès 0,7, sans écart minimal exigé." in block
    assert "incertain dès 0,85, identifié dès 0,85 avec une marge d'au moins 0,1." in block
    assert "0.85" not in block and "marge d'au moins 0," in block
    for t, m in man["metrics"].items():
        counts = man["data"]["counts"][t]["by_polymer"]
        absent = sorted(set(counts) - set(m["recall_by_polymer"]))
        assert absent  # the real manifest has some
        for code in absent:
            assert f"{code} ({counts[code]})" in block
    assert "présents dans une seule bibliothèque" in block


def test_card_prose_does_not_call_single_library_polymers_absent_from_training():
    text = CARD.read_text(encoding="utf-8")
    assert "absents de l'apprentissage" not in text
    assert "Polymère absent de l'apprentissage" not in text
    assert "absents des validations" in text or "absents des tours de validation" in text
