"""POST /ai/spectral/identify and GET /ai/spectral/model, on a small synthetic model."""
from __future__ import annotations

import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import pytest

from microtrace_engine.spectral import (
    ModelLock,
    ModelState,
    SpectralModelStore,
    read_lock,
)

from .conftest import _CORE_TESTS, spectral_client
from .test_app_basics import _protected_routes

ROOT = Path(__file__).resolve().parents[2]
MISSING = "Modèle spectral absent : lancez l'entraînement (python -m microtrace_core train-spectral)."
MISMATCH = ("Le fichier du modèle spectral ne correspond pas à l'empreinte attendue : "
            "il n'est pas utilisé.")
FORM = {"technique": "ftir_atr", "x_unit": "cm-1", "y_unit": "absorbance"}
RAMAN = {"technique": "raman", "x_unit": "cm-1", "y_unit": "intensity", "laser_nm": "532"}


def _csv(x, y) -> bytes:
    return "\n".join(f"{a:.6f},{b:.8f}" for a, b in zip(x, y, strict=True)).encode()


def _fx():
    if str(_CORE_TESTS) not in sys.path:
        sys.path.insert(0, str(_CORE_TESTS))
    import spectral_fixtures

    return spectral_fixtures


@pytest.fixture
def client(spectral_models_dir):
    return spectral_client(spectral_models_dir.path, spectral_models_dir.lock)


def _post(client, headers, data, form, name="s.csv"):
    return client.post("/ai/spectral/identify", headers=headers,
                       files={"file": (name, data)}, data=form)


def _reference_csv(spectrum_id: str) -> bytes:
    df = _fx().make_catalog()
    row = df[df.spectrum_id == spectrum_id].iloc[0]
    return _csv(row.x_raw, row.y_raw)


def test_model_info_available(client, auth_headers, spectral_models_dir):
    r = client.get("/ai/spectral/model", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True and body["reason"] is None and body["message"] is None
    assert body["name"] == "c5-spectral" and body["version"] == "s1"
    assert body["sha256"] == body["expected_sha256"] == spectral_models_dir.expected_sha256
    assert body["trial_label"] == "Modèle d'essai"
    assert body["trial_sentence"] == (
        "Modèle d'essai : entraîné sur des données publiques, pas encore sur les vôtres.")
    assert "n'a pas vu de particules extraites de sang" in body["limits"][1]
    assert "pas de classe non plastique dans cette version" in body["limits"][2]
    assert body["card_path"] == "docs/models/c5-spectral.md"
    assert body["max_bytes"] == 2 * 1024 * 1024 and body["max_points"] == 100_000
    mpx = next(lib for lib in body["libraries"] if lib["code"] == "mpx")
    assert mpx["licence_text"] == "CC BY-SA 4.0" and mpx["curve_allowed"] is True
    assert mpx["n_ftir_atr"] == 60 and mpx["n_raman"] == 60
    flopp = next(lib for lib in body["libraries"] if lib["code"] == "flopp")
    assert flopp["curve_allowed"] is False and flopp["licence_text"] == "Licence à confirmer"
    assert [t["technique"] for t in body["techniques"]] == ["raman", "ftir_atr"]
    t = body["techniques"][0]
    assert t["n_references"] == 120 and t["metrics"] is None  # the synthetic model has none
    assert [p["code"] for p in t["polymers"]] == ["A", "B", "C"]


def test_model_missing(tmp_path, auth_headers):
    lock = ModelLock("c5-spectral", "s1", "c5-spectral-s1.npz", "0" * 64)
    client = spectral_client(tmp_path, lock)
    info = client.get("/ai/spectral/model", headers=auth_headers).json()
    assert info["available"] is False and info["reason"] == "missing"
    assert info["message"] == MISSING and info["sha256"] is None
    assert info["techniques"] == [] and info["expected_sha256"] == "0" * 64
    r = _post(client, auth_headers, b"1,2\n" * 20, FORM)
    assert r.status_code == 503 and r.json()["detail"] == MISSING
    assert client.get("/health").status_code == 200  # the engine still serves everything else


def test_sha_mismatch_refuses_to_serve(spectral_models_dir, tmp_path, auth_headers):
    data = bytearray((spectral_models_dir.path / "c5-spectral-s1.npz").read_bytes())
    data[len(data) // 2] ^= 0xFF
    (tmp_path / "c5-spectral-s1.npz").write_bytes(bytes(data))
    calls = []

    def spy(raw):
        calls.append(1)
        raise AssertionError("loader must not run")

    store = SpectralModelStore(tmp_path, spectral_models_dir.lock, loader=spy)
    state, model, digest = store.get()
    assert state is ModelState.SHA_MISMATCH and model is None
    assert digest == hashlib.sha256(bytes(data)).hexdigest() and calls == []
    client = spectral_client(tmp_path, spectral_models_dir.lock)
    info = client.get("/ai/spectral/model", headers=auth_headers).json()
    assert info["available"] is False and info["reason"] == "sha_mismatch"
    assert info["sha256"] is None and info["techniques"] == []
    r = _post(client, auth_headers, b"1,2\n" * 20, FORM)
    assert r.status_code == 503 and r.json()["detail"] == MISMATCH


def test_invalid_archive(tmp_path, auth_headers):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("x.txt", "hello")
    data = buf.getvalue()
    (tmp_path / "c5-spectral-s1.npz").write_bytes(data)
    lock = ModelLock("c5-spectral", "s1", "c5-spectral-s1.npz", hashlib.sha256(data).hexdigest())
    client = spectral_client(tmp_path, lock)
    info = client.get("/ai/spectral/model", headers=auth_headers).json()
    assert info["available"] is False and info["reason"] == "invalid"
    assert info["message"] == "Le fichier du modèle spectral est illisible : il n'est pas utilisé."
    assert _post(client, auth_headers, b"1,2\n" * 20, FORM).status_code == 503


def test_state_is_cached_until_restart(spectral_models_dir, tmp_path):
    (tmp_path / "c5-spectral-s1.npz").write_bytes(
        (spectral_models_dir.path / "c5-spectral-s1.npz").read_bytes())
    store = SpectralModelStore(tmp_path, spectral_models_dir.lock)
    first = store.get()
    assert first[0] is ModelState.OK
    (tmp_path / "c5-spectral-s1.npz").unlink()
    assert store.get() is first


def test_identify_contract(client, auth_headers):
    data = _reference_csv("mpx:ftir_atr:B00")
    r = _post(client, auth_headers, data, FORM)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "identified" and body["status_label"] == "Identifié (proposition)"
    assert body["abstention"] is None
    assert [c["rank"] for c in body["candidates"]] == [1, 2, 3]
    assert body["candidates"][0]["polymer"] == "B"
    assert len(body["references"]) == 5
    assert body["references"][0]["curve"] is not None
    assert body["references"][0]["score_text"] == "1,000"
    assert body["input"]["sha256"] == hashlib.sha256(data).hexdigest()
    assert body["input"]["size"] == len(data) and body["input"]["technique_label"] == "FTIR (ATR)"
    assert body["model"]["name"] == "c5-spectral" and body["model"]["sha256"]
    assert len(body["query_curve"]["x"]) == len(body["query_curve"]["y"]) > 100
    assert "corrélation 1,000" in body["explanation"]
    assert "Proposition à valider par une personne compétente." in body["explanation"]
    assert {"code": "NOT_PLASTIC", "label": "Non plastique"} in body["correction_vocabulary"]
    assert len(body["correction_vocabulary"]) == 22
    assert body["thresholds"]["classifier_agreement_required"] is True
    assert body["x_label"] == "Nombre d'onde (cm⁻¹)"
    assert body["trial_label"] == "Modèle d'essai" and len(body["limits"]) == 5


def test_identify_hides_unlicensed_curves(client, auth_headers):
    r = _post(client, auth_headers, _reference_csv("flopp:ftir_atr:B00"), FORM)
    assert r.status_code == 200
    refs = r.json()["references"]
    assert refs[0]["library"] == "flopp"
    assert refs[0]["curve"] is None
    assert refs[0]["licence_text"] == "Licence à confirmer"
    assert refs[0]["curve_note"] == "Licence à confirmer : courbe non affichée."
    for ref in refs:  # only MicroPlastiX curves are ever returned
        assert (ref["curve"] is not None) == (ref["library"] == "mpx")


def test_identify_abstention_texts(client, auth_headers):
    fx = _fx()
    x, y = fx.noise_curve(0)
    noise = _post(client, auth_headers, _csv(x, y), RAMAN).json()
    assert noise["status_label"] == "Non identifié (abstention)"
    assert noise["abstention"] == "low_score"
    assert noise["explanation"].startswith("Aucune proposition fiable : la meilleure corrélation")
    # partial coverage: the diagnostic window is 400-1800 cm-1
    xs = np.arange(200.0, 900.0, 2.0)
    _, ys = fx.clean_curve("raman", "A", xs)
    partial = _post(client, auth_headers, _csv(xs, ys), RAMAN).json()
    assert partial["abstention"] == "low_coverage" and partial["candidates"] == []
    assert "il en faut 80 %" in partial["explanation"]
    # an FTIR spectrum declared Raman
    xs, ys = fx.clean_curve("ftir_atr", "B")
    wrong = _post(client, auth_headers, _csv(xs, ys), RAMAN).json()
    assert wrong["abstention"] == "technique_mismatch"
    assert "ressemble davantage à un spectre FTIR" in wrong["explanation"]
    assert wrong["status_label"] == "Non identifié (abstention)"


@pytest.mark.parametrize(("form", "message"), [
    ({**RAMAN, "technique": "uv"}, "Technique inconnue : choisissez Raman ou FTIR (ATR)."),
    ({**FORM, "x_unit": "nm"}, "Un axe en longueur d'onde (nm) n'est possible qu'en Raman."),
    ({k: v for k, v in RAMAN.items() if k != "laser_nm"},
     "Indiquez la longueur d'onde du laser (nm) pour un spectre Raman."),
    ({**RAMAN, "laser_nm": "150"}, "Longueur d'onde du laser invalide (entre 200 et 1 100 nm)."),
    ({**FORM, "laser_nm": "532"}, "Pas de laser pour un spectre FTIR."),
    ({**RAMAN, "y_unit": "absorbance"}, "Unité de l'ordonnée incompatible avec la technique."),
    ({**RAMAN, "x_unit": "mm"}, "Unité de l'axe inconnue."),
])
def test_identify_validation_422(client, auth_headers, form, message):
    r = _post(client, auth_headers, b"1,2\n" * 20, form)
    assert r.status_code == 422 and r.json()["detail"] == message


_ROWS = "".join(f"{400 + i},{i}\n" for i in range(6))


@pytest.mark.parametrize(("data", "message"), [
    (b"\x00\x01\x02\x03" * 8, "Fichier binaire non reconnu : déposez un fichier texte à deux "
                              "colonnes (CSV ou TXT)."),
    (b"##TITLE=x\n##JCAMP-DX=5.00\n1,2\n", "Format JCAMP-DX non pris en charge dans cette "
                                           "version : exportez le spectre en CSV à deux colonnes."),
    ((_ROWS + "12,abc\n" + "500,1\n" * 5).encode(), "Ligne 7 : valeurs non numériques."),
    ("".join(f"{400 + i},{i}\n" for i in range(9)).encode(),
     "Spectre trop court : 9 points, il en faut au moins 10."),
    (b"   \n", "Fichier vide."),
])
def test_identify_read_errors_422(client, auth_headers, data, message):
    r = _post(client, auth_headers, data, FORM)
    assert r.status_code == 422 and r.json()["detail"] == message


def test_identify_too_large_413(client, auth_headers):
    r = _post(client, auth_headers, b"1,2\n" * (2 * 1024 * 1024 // 4) + b"x", FORM)
    assert r.status_code == 413
    assert r.json()["detail"] == "Fichier trop volumineux (limite : 2 Mo)."


def test_lock_matches_manifest():
    manifest = json.loads(
        (ROOT / "docs" / "models" / "c5-spectral-manifest.json").read_text(encoding="utf-8"))
    lock = read_lock()
    model = manifest["model"]
    assert (lock.name, lock.version, lock.file, lock.sha256) == (
        model["name"], model["version"], model["file"], model["sha256"])


def test_spectral_routes_are_protected():
    routes = _protected_routes()
    assert ("/ai/spectral/model", "GET") in routes
    assert ("/ai/spectral/identify", "POST") in routes


def test_spectral_routes_need_the_secret(client):
    assert client.get("/ai/spectral/model").status_code == 401
    assert client.post("/ai/spectral/identify", files={"file": ("s.csv", b"1,2")},
                       data=FORM).status_code == 401


def test_app_starts_without_weights(tmp_path):
    # create_app never reads the weights: a missing file only shows up on the spectral routes
    spectral_client(tmp_path, ModelLock("c5-spectral", "s1", "nope.npz", "0" * 64))
