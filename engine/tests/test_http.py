"""HTTP contract: secret and size gate, French errors, sanitised 422s, threadpool."""
import asyncio
import json
import logging
import threading
import time

from microtrace_core.results import leslie_like_context, leslie_like_csv, leslie_like_mapping

from microtrace_engine import app as app_module
from microtrace_engine import convert
from microtrace_engine.app import create_app
from microtrace_engine.settings import Settings

from .conftest import TEST_SECRET, TestClient

SECRET_401 = {"detail": "Secret du moteur manquant ou invalide."}


def _form(**over):
    form = {
        "mapping": convert.mapping_to_model(leslie_like_mapping()).model_dump_json(),
        "context": convert.context_to_model(leslie_like_context()).model_dump_json(),
    }
    form.update(over)
    return form


# ---- pure ASGI gate: secret and declared size, before any body is read ----


def _call(scope_headers, path="/tables/read", method="POST"):
    """Run the app on one raw ASGI request whose body must never be read."""
    app = create_app(Settings(secret=TEST_SECRET))
    sent: list[dict] = []

    async def receive():
        raise AssertionError("body read before the gate")

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
             "query_string": b"", "root_path": "", "server": ("127.0.0.1", 8001),
             "client": ("127.0.0.1", 5000),
             "headers": [(k.lower().encode(), v.encode()) for k, v in scope_headers.items()]}
    asyncio.run(app(scope, receive, send))
    start = next(m for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return start["status"], json.loads(body)


def test_gate_rejects_missing_secret_before_body():
    for headers in ({}, {"X-Engine-Secret": "x" * 40}, {"X-Engine-Secret": ""}):
        assert _call({"content-type": "multipart/form-data; boundary=b", **headers}) == (
            401, SECRET_401)


def test_gate_rejects_declared_oversize_before_body():
    limit = app_module.MAX_REQUEST_BYTES
    status, body = _call({"X-Engine-Secret": TEST_SECRET, "content-length": str(limit + 1)})
    assert status == 413 and "volumineuse" in body["detail"]


def test_gate_lets_health_through(client):
    assert client.get("/health").status_code == 200


def test_no_secret_wins_over_bad_multipart(client):
    r = client.post("/tables/read", content=b"garbage",
                    headers={"content-type": "multipart/form-data; boundary=zz"})
    assert r.status_code == 401 and r.json() == SECRET_401


# ---- French errors ----


def test_french_404_405(client, auth_headers):
    r = client.get("/nope", headers=auth_headers)
    assert r.status_code == 404 and r.json() == {"detail": "Ressource introuvable."}
    r = client.get("/summary", headers=auth_headers)
    assert r.status_code == 405 and r.json() == {"detail": "Méthode non autorisée."}
    assert "POST" in r.headers["allow"]


def test_oversized_form_field_is_french_422(client, auth_headers):
    r = client.post("/imports/check", headers=auth_headers,
                    files={"file": ("leslie.csv", leslie_like_csv())},
                    data=_form(mapping="x" * (1024 * 1024 + 10)))
    assert r.status_code == 422
    assert r.json()["detail"].startswith("Corps de requête multipart illisible")


def test_malformed_multipart_is_french_422(client, auth_headers):
    r = client.post("/tables/read", content=b"--zz\r\nnot a part",
                    headers={**auth_headers,
                             "content-type": "multipart/form-data; boundary=zz"})
    assert r.status_code == 422
    assert r.json()["detail"].startswith("Corps de requête multipart illisible")


# ---- useful, sanitised 422s ----


def test_validation_errors_listed_without_input(client, auth_headers):
    r = client.post("/summary", headers=auth_headers,
                    json={"records": [{"sample_id": "PRIVATE-0612345678", "value": "abc"}]})
    assert r.status_code == 422
    body = r.json()
    assert set(body) == {"detail", "errors"} and "invalide" in body["detail"]
    assert body["errors"] and all(set(e) == {"loc", "type"} for e in body["errors"])
    assert {"loc": ["body", "records", 0, "aliquot"], "type": "missing"} in body["errors"]
    assert "PRIVATE" not in r.text and "abc" not in r.text


def test_part_errors_located_and_user_keys_masked(client, auth_headers):
    bad = {"mode": "wide", "field_columns": {"jean.dupont@chu.fr": 5},
           "polymer_columns": {"Mme Martin": None}, "constants": {"tel 0612": 1}}
    r = client.post("/imports/check", headers=auth_headers,
                    files={"file": ("leslie.csv", leslie_like_csv())},
                    data=_form(mapping=json.dumps(bad)))
    assert r.status_code == 422
    body = r.json()
    assert "mapping" in body["detail"]
    locs = sorted(tuple(e["loc"]) for e in body["errors"])
    assert locs == [("mapping", "constants", "*"), ("mapping", "field_columns", "*"),
                    ("mapping", "polymer_columns", "*")]
    for leak in ("jean.dupont", "Martin", "0612"):
        assert leak not in r.text


def test_unknown_extra_key_masked(client, auth_headers):
    r = client.post("/summary", headers=auth_headers, json={"records": [], "Mme Martin": 1})
    assert r.status_code == 422
    assert r.json()["errors"] == [{"loc": ["body", "*"], "type": "extra_forbidden"}]


# ---- narrowed exception handling ----


def test_unexpected_b1_error_is_generic(auth_headers, monkeypatch, caplog):
    def boom(*_a, **_k):
        raise ValueError("cellule 0612345678")

    monkeypatch.setattr(app_module, "run_import", boom)
    client = TestClient(create_app(Settings(secret=TEST_SECRET)),
                        raise_server_exceptions=False)
    caplog.set_level(logging.DEBUG)
    r = client.post("/imports/check", headers=auth_headers,
                    files={"file": ("leslie.csv", leslie_like_csv())}, data=_form())
    assert r.status_code == 500 and r.json() == {"detail": "Erreur interne du moteur."}
    assert "0612345678" not in caplog.text and "ValueError" in caplog.text


# ---- CPU work off the event loop ----


def test_health_answers_during_slow_check(auth_headers, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    real = app_module.run_import
    done: list[float] = []

    def slow(*args):
        entered.set()
        release.wait(10)
        done.append(time.monotonic())
        return real(*args)

    monkeypatch.setattr(app_module, "run_import", slow)
    with TestClient(create_app(Settings(secret=TEST_SECRET))) as client:
        out: list = []
        t = threading.Thread(target=lambda: out.append(client.post(
            "/imports/check", headers=auth_headers,
            files={"file": ("leslie.csv", leslie_like_csv())}, data=_form())))
        t.start()
        try:
            assert entered.wait(10)
            assert client.get("/health").status_code == 200
            assert not done  # /health answered while the check was still running
        finally:
            release.set()
            t.join(20)
    assert out and out[0].status_code == 200
