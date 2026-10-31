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


def _runtime_tree() -> dict[str, str]:
    """Installed name -> version for the runtime dependencies of core and engine (Linux)."""
    from importlib.metadata import distribution

    from packaging.markers import default_environment
    from packaging.requirements import Requirement

    env = {**default_environment(), "sys_platform": "linux", "platform_system": "Linux",
           "os_name": "posix", "extra": ""}
    seen: dict[str, str] = {}
    stack = ["microtrace-core", "microtrace-engine"]
    while stack:
        dist = distribution(stack.pop())
        name = dist.metadata["Name"].lower().replace("_", "-")
        if name in seen:
            continue
        seen[name] = dist.version
        for raw in dist.requires or []:
            req = Requirement(raw)
            if req.marker is None or req.marker.evaluate(env):
                stack.append(req.name)
    return {k: v for k, v in seen.items() if not k.startswith("microtrace-")}


def test_constraints_pin_the_tested_runtime_tree():
    from pathlib import Path

    text = (Path(__file__).resolve().parents[1] / "constraints.txt").read_text("utf-8")
    pins = dict(line.strip().split("==") for line in text.splitlines()
                if line.strip() and not line.startswith("#"))
    assert pins == _runtime_tree()


def test_spectral_logs_hold_no_file_name_nor_values(spectral_models_dir, auth_headers, caplog):
    from .conftest import spectral_client

    client = spectral_client(spectral_models_dir.path, spectral_models_dir.lock)
    rows = [f"{400 + 10 * i},{i * i + 1}" for i in range(40)]
    rows[5] = "450,123456.789"
    good = "\n".join(rows).encode()
    bad = good + b"\n500,abc DONOR-SECRET\n"
    caplog.set_level(logging.DEBUG)
    for name in ("", "uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        logging.getLogger(name).setLevel(logging.DEBUG)
    form = {"technique": "raman", "x_unit": "cm-1", "y_unit": "intensity", "laser_nm": "532"}
    ok = client.post("/ai/spectral/identify", headers=auth_headers,
                     files={"file": ("DONOR-SECRET.csv", good)}, data=form)
    ko = client.post("/ai/spectral/identify", headers=auth_headers,
                     files={"file": ("DONOR-SECRET.csv", bad)}, data=form)
    assert ok.status_code == 200 and ko.status_code == 422
    assert "DONOR-SECRET" not in caplog.text and "123456.789" not in caplog.text
    assert "DONOR-SECRET" not in ok.text and "DONOR-SECRET" not in ko.text


def test_quality_logs_hold_no_sample_id_nor_control_source(client, auth_headers, caplog):
    from microtrace_core.results import run_import
    from microtrace_core.results.examples import leslie_like_wide_table

    table = leslie_like_wide_table()
    result = run_import(table, leslie_like_mapping(table), leslie_like_context())
    records = []
    for x in result.records:
        d = convert.record_to_model(x).model_dump()
        d.update(import_id="imp-1", file_sha256="a" * 64, sheet="")
        d["sample_id"] = "DONOR-SECRET-" + d["sample_id"]
        records.append(d)
    blank = {"id": "qc1", "polymer": "PET", "kind": "procedural_blank", "n": 3, "mean": 250,
             "unit_code": "ng/mL", "source": "SOURCE-SECRET-77"}
    caplog.set_level(logging.DEBUG)
    ok = client.post("/quality", headers=auth_headers,
                     json={"records": records, "qc_summaries": [blank]})
    dup = client.post("/quality", headers=auth_headers,
                      json={"records": records + records[:1], "qc_summaries": [blank]})
    bad = client.post("/quality", headers=auth_headers,
                      json={"records": [{"sample_id": "DONOR-SECRET-9"}]})
    assert ok.status_code == 200 and dup.status_code == 422 and bad.status_code == 422
    assert "DONOR-SECRET" not in caplog.text and "SOURCE-SECRET" not in caplog.text
    assert "DONOR-SECRET-9" not in bad.text and "SOURCE-SECRET" not in dup.text
