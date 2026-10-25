import logging

from fastapi import Depends
from fastapi.testclient import TestClient
from microtrace_core.results import leslie_like_csv

from microtrace_engine import convert
from microtrace_engine.app import create_app
from microtrace_engine.settings import Settings
from microtrace_core.results import leslie_like_context, leslie_like_mapping

from .conftest import TEST_SECRET

PII = ("jean.dupont@chu.fr", "06 12 34 56 78", "Jean Dupont")


def _pii_file() -> bytes:
    text = leslie_like_csv().decode("utf-8")
    lines = text.splitlines()
    sep = ";" if lines[0].count(";") > lines[0].count(",") else ","
    out = [lines[0] + sep + "jean.dupont@chu.fr"]
    for i, ln in enumerate(lines[1:]):
        extra = ("jean.dupont@chu.fr", "06 12 34 56 78", "Jean Dupont")[i % 3]
        out.append(ln + sep + extra)
    return ("\n".join(out) + "\n").encode("utf-8")


def test_no_cell_values_in_logs_or_errors(auth_headers, caplog):
    client = TestClient(create_app(Settings(secret=TEST_SECRET)), raise_server_exceptions=False)
    data = _pii_file()
    form = {
        "mapping": convert.mapping_to_model(leslie_like_mapping()).model_dump_json(),
        "context": convert.context_to_model(leslie_like_context()).model_dump_json(),
    }
    caplog.set_level(logging.DEBUG)
    for name in ("", "uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        logging.getLogger(name).setLevel(logging.DEBUG)
    r1 = client.post("/tables/read", headers=auth_headers, files={"file": ("p.csv", data)})
    r2 = client.post("/imports/check", headers=auth_headers,
                     files={"file": ("p.csv", data)}, data=form)
    bad = client.post("/imports/check", headers=auth_headers,
                      files={"file": ("p.csv", data)}, data={**form, "context": "{"})
    for p in PII:
        assert p not in caplog.text
        assert p not in r2.text and p not in bad.text
        # headers never appear in the /tables/read preview header list
        assert p not in r1.json()["columns"]
    # cells may only appear in the /tables/read preview, never in its header list
    assert all(p not in c for c in r1.json()["columns"] for p in PII)
    assert r1.status_code == 200


def test_unexpected_error_is_generic(auth_headers, caplog):
    app = create_app(Settings(secret=TEST_SECRET))

    def boom():
        raise RuntimeError("secret 0612345678")

    app.add_api_route("/boom", boom, dependencies=[Depends(app.state.require_secret)])
    client = TestClient(app, raise_server_exceptions=False)
    caplog.set_level(logging.DEBUG)
    r = client.get("/boom", headers=auth_headers)
    assert r.status_code == 500
    assert r.json() == {"detail": "Erreur interne du moteur."}
    assert "0612345678" not in caplog.text and "0612345678" not in r.text
    assert "RuntimeError" in caplog.text and "/boom" in caplog.text
    # HTTPException handling is untouched
    assert client.get("/boom").status_code == 401
