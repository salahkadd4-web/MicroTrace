import pytest
from fastapi import Depends
from fastapi.routing import APIRoute

from microtrace_engine.app import create_app
from microtrace_engine.settings import Settings, load_settings

from .conftest import TEST_SECRET, TestClient


def test_health_without_secret(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"engine_api", "engine_version", "rules_version"}
    assert body["engine_api"] == 1


def _protected_routes(app=None) -> list[tuple[str, str]]:
    app = app or create_app(Settings(secret=TEST_SECRET))
    return sorted(
        {
            (r.path, m)
            for r in app.routes
            if isinstance(r, APIRoute) and r.path != "/health"
            for m in r.methods - {"HEAD", "OPTIONS"}
        }
    )


_BAD_HEADERS = ({}, {"X-Engine-Secret": "x" * 40}, {"X-Engine-Secret": ""})


@pytest.mark.parametrize("path,method", _protected_routes())
def test_secret_required_everywhere(client, path, method):
    for headers in _BAD_HEADERS:
        r = client.request(method, path, headers=headers)
        assert r.status_code == 401
        assert r.json() == {"detail": "Secret du moteur manquant ou invalide."}


def test_post_route_is_covered_and_not_405():
    app = create_app(Settings(secret=TEST_SECRET))
    app.add_api_route(
        "/_probe",
        lambda: {"ok": True},
        methods=["POST"],
        dependencies=[Depends(app.state.require_secret)],
    )
    assert ("/_probe", "POST") in _protected_routes(app)
    c = TestClient(app)
    for headers in _BAD_HEADERS:
        assert c.post("/_probe", headers=headers).status_code == 401
    ok = c.post("/_probe", headers={"X-Engine-Secret": TEST_SECRET})
    assert ok.status_code == 200


def test_openapi_route_is_covered():
    assert ("/openapi.json", "GET") in _protected_routes()


def test_short_secret_refused(monkeypatch):
    monkeypatch.setenv("ENGINE_SECRET", "court")
    with pytest.raises(ValueError):
        load_settings()
    monkeypatch.delenv("ENGINE_SECRET")
    with pytest.raises(ValueError):
        load_settings()


def test_load_settings_defaults_and_overrides(monkeypatch):
    monkeypatch.setenv("ENGINE_SECRET", "k" * 32)
    monkeypatch.delenv("ENGINE_HOST", raising=False)
    monkeypatch.delenv("ENGINE_PORT", raising=False)
    s = load_settings()
    assert (s.host, s.port) == ("127.0.0.1", 8001)
    monkeypatch.setenv("ENGINE_PORT", "9000")
    assert load_settings().port == 9000


def test_settings_repr_hides_secret():
    assert TEST_SECRET not in repr(Settings(secret=TEST_SECRET))


def test_docs_disabled(client, auth_headers):
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    r = client.get("/openapi.json", headers=auth_headers)
    assert r.status_code == 200
    assert "paths" in r.json()
