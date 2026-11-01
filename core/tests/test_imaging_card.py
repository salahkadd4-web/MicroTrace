"""The versioned image-model card must match the versioned manifest (not marked data)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from microtrace_core.imaging.train import BEGIN_MARKER, END_MARKER, _fr, _pct, render_card_metrics

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
    """Prose figures outside the generated block are compared to the manifest."""
    text = CARD.read_text(encoding="utf-8")
    man = _manifest()
    d, s = man["data"], man["selection"]["settings"]
    sp = d["by_split"]
    for needle in (
            f"{d['images']} images en {d['n_groups']} groupes",
            f"{sp['train']} en apprentissage, {sp['val']} en validation, {sp['test']} en test",
            f"seuil de probabilité {_fr(s['pixel_threshold'])}",
            f"taille minimale {_fr(100 * s['min_area_frac'])} % de l'image",
            f"score minimal {_fr(s['shape_min_score'])}",
            f"part segmentée supérieure à {_fr(100 * s['max_foreground'])} %",
            f"{_fr(round(s['scale_min'], 3))} à {_fr(round(s['scale_max'], 2))} µm",
            f"{man['data']['data_list']['files']} fichiers",
            f"sur les {s_val(man)} images de validation",
            f"test lu une seule fois** ({man['metrics']['n_images']} images)"):
        assert needle in text, needle
    # the generated reading carries the bead weaknesses and the scale margin
    block = render_card_metrics(man)
    assert "Billes (`bead`), peu et mal évaluées" in block and "élargi d'un facteur 2" in block
    bead = man["metrics"]["by_subset"]["bead"]["size"]
    assert f"{_pct(bead['feret_rel_err_median'])}" in block
    assert "Billes (`bead`)" in block and block in text
    for name in ("fibre_2", "fragment_2", "fibre_1", "bead"):
        assert name in text
    ab = man["metrics"]["abstention"]
    assert f"{ab['unreliable']} images « non fiable » sur {ab['n_images']}" in text
    # no hand-typed percentage or decimal figure survives outside the generated block
    i, j = text.index(BEGIN_MARKER), text.index(END_MARKER)
    prose = text[:i] + text[j:]
    import re
    allowed = re.compile(r"1 024|0,0*\d|300|200|2 %|10")
    left = [m for m in re.findall(r"\d+[,.]\d+|\d+ %", prose)
            if not allowed.fullmatch(m)]
    assert not [m for m in left if m not in (f"{_fr(100 * s['min_area_frac'])} %",
                                              f"{_fr(100 * s['max_foreground'])} %", "2 %", _fr(round(s["scale_min"], 3)),
                                              _fr(round(s["scale_max"], 2)))], left


def s_val(man) -> int:
    return man["selection"]["n_validation_images"]
