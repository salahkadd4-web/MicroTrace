from microtrace_core.results import leslie_like_context

from microtrace_engine import convert


def _ctx(**over):
    body = convert.context_to_model(leslie_like_context()).model_dump(mode="json")
    body.update(over)
    return body


def test_valid_context_is_ok(client, auth_headers):
    r = client.post("/context/validate", headers=auth_headers, json=_ctx())
    assert r.status_code == 200 and r.json() == {"ok": True}


def test_b1_rejection_is_422_french(client, auth_headers):
    methods = _ctx()["methods"]
    r = client.post("/context/validate", headers=auth_headers,
                    json=_ctx(methods=[methods[0], dict(methods[0])]))
    assert r.status_code == 422
    assert r.json() == {"detail": f"Méthode « {methods[0]['name']} » déclarée deux fois "
                                  "(casse et espaces ignorés)"}


def test_published_needs_doi_and_license(client, auth_headers):
    r = client.post("/context/validate", headers=auth_headers,
                    json=_ctx(data_nature="published", reference_doi=None))
    assert r.status_code == 422
    assert r.json() == {"detail": "Des données publiées exigent un DOI de référence et une licence."}
    r = client.post("/context/validate", headers=auth_headers,
                    json=_ctx(data_nature="published", reference_doi="10.1234/abc",
                              reference_license="CC-BY-4.0"))
    assert r.status_code == 200 and r.json() == {"ok": True}


def test_requires_secret(client):
    assert client.post("/context/validate", json=_ctx()).status_code == 401
