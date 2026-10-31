"""The OpenAPI schema is the contract the Next.js app generates its types from."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.routing import APIRoute
from microtrace_core.results import ISSUE_CODES

from microtrace_engine.app import create_app, openapi_json
from microtrace_engine.settings import Settings

from .conftest import TEST_SECRET

COMMITTED = Path(__file__).resolve().parents[1] / "openapi.json"
REF = "#/components/schemas/"


@pytest.fixture(scope="module")
def app():
    return create_app(Settings(secret=TEST_SECRET))


@pytest.fixture(scope="module")
def schema(app):
    return app.openapi()


def _operations(schema):
    return [(path, method, op) for path, ops in schema["paths"].items()
            for method, op in ops.items()]


def test_errors_declared_everywhere(schema):
    for path, method, op in _operations(schema):
        for status in ("401", "422", "500"):
            content = op["responses"][status]["content"]["application/json"]
            assert content["schema"] == {"$ref": REF + "ErrorModel"}, (path, method, status)
    names = set(schema["components"]["schemas"])
    assert not names & {"HTTPValidationError", "ValidationError"}
    err = schema["components"]["schemas"]["ErrorModel"]
    assert err["required"] == ["detail"]
    assert set(err["properties"]) == {"detail", "errors"}
    loc = schema["components"]["schemas"]["ErrorLoc"]
    assert set(loc["properties"]) == {"loc", "type"}


def test_health_model(schema):
    ok = schema["paths"]["/health"]["get"]["responses"]["200"]["content"]["application/json"]
    assert ok["schema"] == {"$ref": REF + "HealthResponse"}
    health = schema["components"]["schemas"]["HealthResponse"]
    assert set(health["required"]) == {"engine_api", "engine_version", "rules_version"}
    assert health["properties"]["engine_api"]["type"] == "integer"


def test_json_parts_registered_and_documented(schema):
    names = set(schema["components"]["schemas"])
    assert {"MappingModel", "StudyContextModel", "ExistingKeyModel"} <= names
    op = schema["paths"]["/imports/check"]["post"]
    for name in ("MappingModel", "StudyContextModel", "ExistingKeyModel"):
        assert name in op["description"]
    body = schema["components"]["schemas"]["Body_imports_check"]["properties"]
    assert body["mapping"]["contentSchema"] == {"$ref": REF + "MappingModel"}
    assert body["context"]["contentSchema"] == {"$ref": REF + "StudyContextModel"}


def test_issue_code_is_closed(schema):
    code = schema["components"]["schemas"]["IssueModel"]["properties"]["code"]
    assert set(code["enum"]) == set(ISSUE_CODES)


def test_operation_ids_are_function_names(app, schema):
    names = {r.name for r in app.routes if isinstance(r, APIRoute) and r.include_in_schema}
    ids = {op["operationId"] for _, _, op in _operations(schema)}
    assert ids == names == {"health", "tables_read", "mapping_suggest", "imports_check",
                            "summary", "quality", "report", "dictionary", "example_leslie_like", "example_leslie_2022",
                            "context_validate", "spectral_model", "spectral_identify"}


def test_served_schema_is_the_contract(client, auth_headers, schema):
    assert client.get("/openapi.json", headers=auth_headers).json() == schema


def test_committed_schema_is_current():
    committed = COMMITTED.read_text(encoding="utf-8").replace("\r\n", "\n")
    assert committed == openapi_json(), (
        "engine/openapi.json is stale: python -m microtrace_engine --dump-openapi "
        "engine/openapi.json")


def test_dump_openapi_needs_no_secret(tmp_path):
    out = tmp_path / "openapi.json"
    env = {k: v for k, v in os.environ.items() if not k.startswith("ENGINE_")}
    subprocess.run([sys.executable, "-m", "microtrace_engine", "--dump-openapi", str(out)],
                   check=True, env=env, timeout=60)
    assert json.loads(out.read_text(encoding="utf-8")) == json.loads(openapi_json())
