"""POST /ai/image/analyze|validate and GET /ai/image/model, on a small synthetic model."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import sys
import time
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from microtrace_engine.image import ImageModelStore, ModelLock, ModelState, read_image_lock

from .conftest import _CORE_TESTS, image_client
from .test_app_basics import _protected_routes

ROOT = Path(__file__).resolve().parents[2]
MISSING = "Modèle d'images absent : lancez l'entraînement (python -m microtrace_core train-image)."
MISMATCH = ("Le fichier du modèle d'images ne correspond pas à l'empreinte attendue : "
            "il n'est pas utilisé.")
TRIAL = ("Modèle d'essai : entraîné sur des images publiques de microscopie électronique, "
         "pas encore sur les vôtres.")
NATURE = "Leur nature (plastique ou non) n'est pas déterminée par l'image."
VALIDATE = "Proposition à valider par une personne compétente."
DISCS = [(60, 60, 20), (60, 180, 20), (60, 300, 20), (180, 120, 20), (180, 260, 20)]


def _fx():
    if str(_CORE_TESTS) not in sys.path:
        sys.path.insert(0, str(_CORE_TESTS))
    import imaging_fixtures

    return imaging_fixtures


def _discs_png() -> bytes:
    fx = _fx()
    return fx.png(fx.discs_image(240, 360, DISCS))


@pytest.fixture
def client(image_models_dir):
    return image_client(image_models_dir.path, image_models_dir.lock)


def _post(client, headers, data, scale=None, name="image.png"):
    form = {} if scale is None else {"scale_um_per_px": scale}
    return client.post("/ai/image/analyze", headers=headers, files={"file": (name, data)},
                       data=form)


def _decode_png(b64: str) -> Image.Image:
    img = Image.open(io.BytesIO(base64.b64decode(b64)))
    img.load()
    return img


def test_model_info_available(client, auth_headers, image_models_dir):
    r = client.get("/ai/image/model", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True and body["reason"] is None and body["message"] is None
    assert body["name"] == "c6-microscopie" and body["version"] == "i1"
    assert body["sha256"] == body["expected_sha256"] == image_models_dir.lock.sha256
    assert body["trial_label"] == "Modèle d'essai" and body["trial_sentence"] == TRIAL
    assert len(body["limits"]) == 9
    assert "images MEB seulement" in body["limits"][1]
    assert "ne dit pas si une particule est un plastique" in body["limits"][3]
    assert body["card_path"] == "docs/models/c6-microscopie.md"
    assert body["max_bytes"] == 25 * 1024 * 1024 and body["max_pixels"] == 40_000_000
    assert body["analysis_max_side"] == 1024
    assert {"code": "film", "label": "Film", "evaluated": False} in body["shape_vocabulary"]
    assert [s["code"] for s in body["shape_vocabulary"] if s["evaluated"]] == [
        "fibre", "fragment", "bille"]
    assert body["thresholds"]["pixel"] == 0.5 and body["thresholds"]["min_contrast"] == 10
    assert body["metrics"] is None  # the synthetic model carries none
    assert body["training_data"] == "dataset3 : 237 images MEB, licence à confirmer"


def test_model_missing(tmp_path, auth_headers):
    client = image_client(tmp_path, ModelLock("c6-microscopie", "i1", "c6-microscopie-i1.npz",
                                              "0" * 64))
    info = client.get("/ai/image/model", headers=auth_headers).json()
    assert info["available"] is False and info["reason"] == "missing"
    assert info["message"] == MISSING and info["sha256"] is None
    assert info["thresholds"] is None and info["metrics"] is None
    assert len(info["shape_vocabulary"]) == 4  # the vocabulary does not need the weights
    r = _post(client, auth_headers, _discs_png())
    assert r.status_code == 503 and r.json()["detail"] == MISSING
    assert client.get("/health").status_code == 200


def test_sha_mismatch_refuses_to_serve(image_models_dir, tmp_path, auth_headers):
    name = "c6-microscopie-i1.npz"
    data = bytearray((image_models_dir.path / name).read_bytes())
    data[len(data) // 2] ^= 0xFF
    (tmp_path / name).write_bytes(bytes(data))
    calls = []

    def spy(raw):
        calls.append(1)
        raise AssertionError("loader must not run")

    store = ImageModelStore(tmp_path, image_models_dir.lock, loader=spy)
    state, model, digest = store.get()
    assert state is ModelState.SHA_MISMATCH and model is None
    assert digest == hashlib.sha256(bytes(data)).hexdigest() and calls == []
    client = image_client(tmp_path, image_models_dir.lock)
    info = client.get("/ai/image/model", headers=auth_headers).json()
    assert info["available"] is False and info["reason"] == "sha_mismatch"
    assert info["message"] == MISMATCH and info["sha256"] is None
    r = _post(client, auth_headers, _discs_png())
    assert r.status_code == 503 and r.json()["detail"] == MISMATCH


def test_invalid_archive(tmp_path, auth_headers):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("x.txt", "hello")
    data = buf.getvalue()
    (tmp_path / "c6-microscopie-i1.npz").write_bytes(data)
    lock = ModelLock("c6-microscopie", "i1", "c6-microscopie-i1.npz",
                     hashlib.sha256(data).hexdigest())
    client = image_client(tmp_path, lock)
    info = client.get("/ai/image/model", headers=auth_headers).json()
    assert info["available"] is False and info["reason"] == "invalid"
    assert info["message"] == "Le fichier du modèle d'images est illisible : il n'est pas utilisé."
    assert _post(client, auth_headers, _discs_png()).status_code == 503


def test_analyze_contract(client, auth_headers):
    data = _discs_png()
    r = _post(client, auth_headers, data, "0,5")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "proposal" and body["status_label"] == "Proposition"
    assert body["reasons"] == [] and body["count"] == 5 and len(body["particles"]) == 5
    assert all(len(p["contour"]) >= 4 for p in body["particles"])
    assert body["scale"]["source"] == "entered" and body["scale"]["um_per_px_input"] == 0.5
    assert body["scale"]["source_label"] == "saisie"
    assert body["size_distribution"] is not None
    dist = body["size_distribution"]
    assert dist["basis"] == "feret_max_um" and dist["median_um"] is not None
    assert sum(b["count"] for b in dist["bins"]) == 5
    assert dist["bins"][0]["label"] == "moins de 10 µm" and dist["bins"][-1]["upper"] is None
    assert dist["bins"][-1]["label"] == "5 000 µm et plus"
    assert all(p["feret_max_um"] is not None for p in body["particles"])
    inp = body["input"]
    assert inp["sha256"] == hashlib.sha256(data).hexdigest() and inp["size"] == len(data)
    assert inp["format"] == "PNG" and (inp["width"], inp["height"]) == (360, 240)
    display = _decode_png(body["images"]["display_png_base64"])
    assert display.format == "PNG"
    assert display.size == (inp["analysis_width"], inp["analysis_height"])
    assert _decode_png(body["images"]["annotated_png_base64"]).size == display.size
    assert NATURE in body["explanation"] and VALIDATE in body["explanation"]
    assert body["explanation"].startswith("5 particules candidates (")
    assert body["trial_label"] == "Modèle d'essai" and body["trial_sentence"] == TRIAL
    assert body["model"]["name"] == "c6-microscopie" and body["model"]["sha256"]
    assert body["thresholds"]["shape_min_score"] == 0.6
    assert [c["shape"] for c in body["count_by_shape"]] == [
        "fibre", "fragment", "bille", "film", "uncertain"]
    assert next(c for c in body["count_by_shape"] if c["shape"] == "film")["count"] == 0
    assert sum(c["count"] for c in body["count_by_shape"]) == 5
    for p in body["particles"]:
        assert (p["shape_status"] == "uncertain") == (p["shape"] == "uncertain")
        assert p["shape"] != "film"


def test_analyze_no_scale(client, auth_headers):
    body = _post(client, auth_headers, _discs_png()).json()
    assert body["scale"] is None and body["size_distribution"] is None
    assert all(p["feret_max_um"] is None and p["area_um2"] is None for p in body["particles"])
    assert "Échelle inconnue" in body["explanation"] and " px de diamètre" in body["explanation"]


def test_analyze_hitachi_tiff(client, auth_headers):
    fx = _fx()
    data = fx.trapped_tiff(h=960, w=1280)
    r = _post(client, auth_headers, data)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scale"]["source"] == "metadata" and body["input"]["cropped_bottom_px"] == 60
    assert body["scale"]["source_label"] == "lue dans l'image (MEB Hitachi)"
    assert body["input"]["format"] == "TIFF"
    assert abs(body["scale"]["um_per_px_input"] - 0.9921875) < 1e-9
    assert "Dupont" not in r.text
    for key in ("display_png_base64", "annotated_png_base64"):
        raw = base64.b64decode(body["images"][key])
        assert b"Dupont" not in raw and raw[:8] == b"\x89PNG\r\n\x1a\n"
        assert "tEXt" not in fx.png_chunks(raw) and "eXIf" not in fx.png_chunks(raw)
    same = _post(client, auth_headers, data, "0.99")
    assert same.status_code == 200 and same.json()["scale"]["source"] == "metadata"
    bad = _post(client, auth_headers, data, "2")
    assert bad.status_code == 422
    assert bad.json()["detail"] == (
        "L'échelle saisie (2 µm/px) diffère de celle lue dans l'image (0,9922 µm/px) : "
        "corrigez-la ou laissez le champ vide.")
    assert "Dupont" not in bad.text


def test_analyze_unreliable_texts(client, auth_headers):
    fx = _fx()
    body = _post(client, auth_headers, fx.png(fx.discs_image(200, 300, [], bg=90.0))).json()
    assert body["status"] == "unreliable" and body["status_label"] == "Non fiable (abstention)"
    assert "no_particle" in [r["code"] for r in body["reasons"]]
    assert body["explanation"].startswith("Aucune proposition fiable : ")
    assert "aucune particule candidate détectée" in body["explanation"]
    assert body["explanation"].endswith("Les contours restent visibles à titre indicatif.")
    assert body["count"] == 0 and body["particles"] == []


def test_analyze_large_foreground_text_never_contradicts_the_threshold(client, auth_headers):
    fx = _fx()
    img = fx.rect_image(240, 360, 0, 0, 240, 270)  # 75 % bright
    body = _post(client, auth_headers, fx.png(img)).json()
    assert body["status"] == "unreliable"
    assert "75 % de l'image est segmentée" in body["explanation"]


def test_analyze_scale_out_of_range_text(client, auth_headers):
    body = _post(client, auth_headers, _discs_png(), "40").json()
    assert body["status"] == "unreliable"
    assert "échelle de 40 µm/px hors de la plage d'entraînement (0,06 à 25)" in body["explanation"]


def _gif() -> bytes:
    buf = io.BytesIO()
    Image.new("L", (200, 200)).save(buf, "GIF")
    return buf.getvalue()


def _multipage() -> bytes:
    buf = io.BytesIO()
    frames = [Image.new("L", (200, 200), v) for v in (0, 255)]
    frames[0].save(buf, "TIFF", save_all=True, append_images=frames[1:])
    return buf.getvalue()


BAD_SCALE = "Échelle invalide : un nombre de micromètres par pixel entre 0,001 et 1 000."


@pytest.mark.parametrize(("data", "scale", "message"), [
    (_gif(), None, "Format d'image non pris en charge : déposez un PNG, un JPEG ou un TIFF."),
    (_discs_png()[:300], None, "Image illisible ou tronquée."),
    (_multipage(), None, "TIFF à plusieurs pages non pris en charge : exportez une seule image."),
    (_fx().png(_fx().discs_image(300, 100, [])), None,
     "Image trop petite (100 × 300 px) : il faut au moins 128 px de côté."),
    (_fx().forged_png_header(50_000, 50_000), None,
     "Image trop grande (2 500 millions de pixels) : 40 millions au plus."),
    (_discs_png(), "abc", BAD_SCALE),
    (_discs_png(), "0", BAD_SCALE),
    (_discs_png(), "1001", BAD_SCALE),
    (b"", None, "Fichier vide."),
], ids=["gif", "truncated", "multipage", "too-small", "bomb", "scale-abc", "scale-0",
        "scale-1001", "empty"])
def test_analyze_errors_422(client, auth_headers, data, scale, message):
    r = _post(client, auth_headers, data, scale)
    assert r.status_code == 422 and r.json()["detail"] == message


def test_analyze_too_large_413(client, auth_headers):
    r = _post(client, auth_headers, b"\x89PNG" + b"0" * (25 * 1024 * 1024))
    assert r.status_code == 413
    assert r.json()["detail"] == "Fichier trop volumineux (limite : 25 Mo)."


def test_too_large_is_refused_before_decoding(client, auth_headers, monkeypatch):
    from microtrace_engine import app as app_module

    def boom(data):
        raise AssertionError("must not decode")

    monkeypatch.setattr(app_module, "decode_image", boom)
    r = _post(client, auth_headers, b"\x89PNG" + b"0" * (25 * 1024 * 1024))
    assert r.status_code == 413


def test_exactly_the_limit_is_read(client, auth_headers):
    # a file at the limit is read in full (then refused as unreadable, not as too large)
    r = _post(client, auth_headers, b"x" * (25 * 1024 * 1024))
    assert r.status_code == 422


def _analysis(client, headers) -> dict:
    return _post(client, headers, _discs_png(), "0,5").json()


def test_validate(client, auth_headers):
    body = _analysis(client, auth_headers)
    analysis = {k: body[k] for k in ("particles", "scale", "count")}
    first = body["particles"][0]
    other = next(p for p in body["particles"] if p["id"] != first["id"])
    new_shape = "fibre" if other["shape"] != "fibre" else "fragment"
    req = {"analysis": analysis, "excluded": [first["id"]], "missed_count": 1,
           "reshaped": [{"id": other["id"], "shape": new_shape}]}
    r = client.post("/ai/image/validate", headers=auth_headers, json=req)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["count"] == 5 and out["kept"] == 4 and out["excluded"] == 1 and out["missed"] == 1
    assert out["changes"] == 1
    assert out["sentence"] == ("5 particules candidates validées : 4 proposées gardées, "
                               "1 exclue, 1 ajoutée sans contour.")
    shapes = {c["shape"]: c["count"] for c in out["count_by_shape"]}
    assert shapes["unspecified"] == 1 and sum(shapes.values()) == 5 and shapes[new_shape] >= 1
    assert sum(b["count"] for b in out["size_distribution"]["bins"]) == 4
    # same shape as proposed: ignored, not an error
    ok = client.post("/ai/image/validate", headers=auth_headers, json={
        "analysis": analysis, "excluded": [], "missed_count": 0,
        "reshaped": [{"id": other["id"], "shape": other["shape"]}]})
    assert ok.status_code == 200 and ok.json()["changes"] == 0


@pytest.mark.parametrize(("extra", "message"), [
    ({"excluded": [99]}, "Particule 99 inconnue."),
    ({"reshaped": [{"id": 99, "shape": "fibre"}]}, "Particule 99 inconnue."),
    ({"excluded": [1], "reshaped": [{"id": 1, "shape": "film"}]},
     "Particule 1 : exclue ou reformée, pas les deux."),
    ({"reshaped": [{"id": 1, "shape": "plume"}]}, "Forme inconnue."),
    ({"reshaped": [{"id": 1, "shape": "fibre"}, {"id": 1, "shape": "film"}]},
     "Particule 1 : forme corrigée plusieurs fois."),
])
def test_validate_422(client, auth_headers, extra, message):
    body = _analysis(client, auth_headers)
    req = {"analysis": {k: body[k] for k in ("particles", "scale", "count")},
           "excluded": [], "reshaped": [], "missed_count": 0, **extra}
    r = client.post("/ai/image/validate", headers=auth_headers, json=req)
    assert r.status_code == 422 and r.json()["detail"] == message


def _recorded(body):
    return {k: body[k] for k in ("particles", "scale", "count")}


def test_validate_refuses_inconsistent_recorded_analyses(client, auth_headers):
    import copy

    body = _analysis(client, auth_headers)

    def post(analysis):
        return client.post("/ai/image/validate", headers=auth_headers, json={
            "analysis": analysis, "excluded": [], "reshaped": [], "missed_count": 0})

    dup = copy.deepcopy(_recorded(body))
    dup["particles"][1]["id"] = dup["particles"][0]["id"]
    r = post(dup)
    assert r.status_code == 422
    assert r.json()["detail"] == (
        f"Analyse enregistrée incohérente : particule {dup['particles'][0]['id']} en double.")
    bad_count = {**_recorded(body), "count": 999}
    r = post(bad_count)
    assert r.status_code == 422 and r.json()["detail"] == (
        "Analyse enregistrée incohérente : 999 particules annoncées pour 5 dans la liste.")
    for shape in ("film", "unspecified"):
        odd = copy.deepcopy(_recorded(body))
        odd["particles"][0]["shape"] = shape
        r = post(odd)
        assert r.status_code == 422 and "forme de la particule" in r.json()["detail"]
    assert post(_recorded(body)).status_code == 200


def test_validate_missed_count_bounds(client, auth_headers):
    body = _analysis(client, auth_headers)
    req = {"analysis": {k: body[k] for k in ("particles", "scale", "count")},
           "excluded": [], "reshaped": [], "missed_count": 10_001}
    assert client.post("/ai/image/validate", headers=auth_headers, json=req).status_code == 422


def test_validate_without_scale_and_without_weights(tmp_path, auth_headers, client):
    body = _post(client, auth_headers, _discs_png()).json()
    gone = image_client(tmp_path, ModelLock("c6-microscopie", "i1", "nope.npz", "0" * 64))
    req = {"analysis": {k: body[k] for k in ("particles", "scale", "count")},
           "excluded": [], "reshaped": [], "missed_count": 2}
    r = gone.post("/ai/image/validate", headers=auth_headers, json=req)
    assert r.status_code == 200
    out = r.json()
    assert out["size_distribution"] is None and out["count"] == 7 and out["kept"] == 5


def test_validated_sentence_singular():
    from microtrace_engine import image_text as text

    assert text.validated_sentence(11, 10, 2, 1) == (
        "11 particules candidates validées : 10 proposées gardées, 2 exclues, "
        "1 ajoutée sans contour.")
    assert text.validated_sentence(1, 1, 0, 0) == (
        "1 particule candidate validée : 1 proposée gardée, 0 exclue, 0 ajoutée sans contour.")


def test_score_text_never_contradicts_the_shape_threshold():
    from microtrace_engine import image_text as text

    assert text.shape_score_text(0.49996, 0.5, False) == "0,49996"
    assert text.shape_score_text(0.4, 0.5, False) == "0,400"
    assert text.shape_score_text(0.5, 0.5, True) == "0,500"


def test_lock_matches_manifest():
    manifest = json.loads(
        (ROOT / "docs" / "models" / "c6-microscopie-manifest.json").read_text(encoding="utf-8"))
    lock = read_image_lock()
    model = manifest["model"]
    assert (lock.name, lock.version, lock.file, lock.sha256) == (
        model["name"], model["version"], model["file"], model["sha256"])


def test_image_routes_are_protected(client):
    routes = _protected_routes()
    for route in (("/ai/image/model", "GET"), ("/ai/image/analyze", "POST"),
                  ("/ai/image/validate", "POST")):
        assert route in routes
    assert client.get("/ai/image/model").status_code == 401
    assert client.post("/ai/image/analyze", files={"file": ("a.png", b"x")}).status_code == 401
    assert client.post("/ai/image/validate", json={}).status_code == 401


def test_app_starts_without_weights(tmp_path):
    image_client(tmp_path, ModelLock("c6-microscopie", "i1", "nope.npz", "0" * 64))


# --- real weights, real image (needs datasets/ and models/) -------------------------------------

@pytest.mark.data
def test_real_model_and_large_image_time():
    weights = ROOT / "models" / "c6-microscopie-i1.npz"
    photo = ROOT / "datasets" / "Images" / "dataset3" / "fragment" / "fragment_1" / "image" / \
        "Foam_No0002.png"
    if not weights.exists() or not photo.exists():
        pytest.skip("models/c6-microscopie-i1.npz or the fragment_1 photo not found")
    from .conftest import TEST_SECRET

    client = image_client(weights.parent, read_image_lock())
    headers = {"X-Engine-Secret": TEST_SECRET}
    info = client.get("/ai/image/model", headers=headers).json()
    assert info["available"] is True and info["sha256"] == info["expected_sha256"]
    assert info["metrics"]["test_images"] == 42 and info["metrics"]["f1_objects"] > 0.5
    assert info["metrics"]["bead_shape_n"] == 7 and info["metrics"]["shape_proposed_balanced_accuracy"] < 0.8
    data = photo.read_bytes()
    assert Image.open(io.BytesIO(data)).size == (2560, 1800)
    start = time.perf_counter()
    r = _post(client, headers, data, "1")
    elapsed = time.perf_counter() - start
    print(f"image analysis 2560x1800: {elapsed:.1f} s")
    assert r.status_code == 200, r.text
    assert elapsed <= 30.0
    body = r.json()
    assert body["status"] in ("proposal", "unreliable") and body["count"] >= 0
    assert body["input"]["analysis_width"] == 1024


def test_reading_figures_equal_the_manifest():
    from microtrace_engine.image import _read_reading
    manifest = json.loads(
        (ROOT / "docs" / "models" / "c6-microscopie-manifest.json").read_text(encoding="utf-8"))
    g = manifest["metrics"]["global"]["shape"]
    b = manifest["metrics"]["by_subset"]["bead"]
    r = _read_reading()
    assert r["shape_proposed_accuracy"] == g["accuracy"]
    assert r["shape_proposed_balanced_accuracy"] == g["balanced_accuracy"]
    assert r["shape_proposed_n"] == g["n"]
    assert r["bead_shape_correct"] == b["shape"]["confusion"]["bille"]["bille"]
    assert r["bead_shape_n"] == b["shape"]["n"]
    assert r["bead_feret_rel_err_median"] == b["size"]["feret_rel_err_median"]


def test_limits_name_beads_fibre_mats_and_the_information_bar():
    from microtrace_engine import image_text as text
    joined = " ".join(text.LIMITS)
    assert "billes" in joined and "tapis de fibres" in joined
    assert "Recadrez la bande d'informations (texte, échelle, date) avant le dépôt" in joined
