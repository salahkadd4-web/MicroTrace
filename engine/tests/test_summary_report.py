import base64

from microtrace_core.results import (
    LESLIE_LIKE_FILENAME,
    RULES_VERSION,
    leslie_like_context,
    leslie_like_csv,
    leslie_like_mapping,
    quantification_frequency,
    run_import,
)
from microtrace_core.results.examples import leslie_like_wide_table

from microtrace_engine import convert
from microtrace_engine.report import to_html

SHA = "a" * 64


def _result():
    return run_import(leslie_like_wide_table(), leslie_like_mapping(), leslie_like_context())


def _imp(rules=RULES_VERSION, name="leslie.csv"):
    return {"file": {"name": name, "sha256": SHA, "size": 10, "sheet": None},
            "rules_version": rules, "date": "2026-10-25", "author": "Test",
            "counts": {"error": 0, "warning": 1, "info": 2}, "issues": []}


def _req(**over):
    r = _result()
    recs = [convert.record_to_model(x).model_dump() for x in r.records]
    body = {"study": {"title": "Étude fictive", "nature": "simulated",
                      "doi": "10.0000/fictif", "license": "CC-BY-4.0",
                      "blank_corrected": "unknown"},
            "imports": [_imp()], "records": recs, "qc_records": [],
            "context": convert.context_to_model(leslie_like_context()).model_dump()}
    body.update(over)
    return body


def test_summary_matches_b1(client, auth_headers):
    r = _result()
    recs = [convert.record_to_model(x).model_dump() for x in r.records]
    body = client.post("/summary", headers=auth_headers, json={"records": recs}).json()
    expected = quantification_frequency(r.records)
    assert len(body["frequencies"]) == len(expected)
    pet = next(f for f in body["frequencies"]
               if f["polymer"] == "PET" and f["matrix"] == "whole_blood")
    assert (pet["n_quantified"], pet["n_samples"]) == (11, 22)
    assert body["stats"] and body["samples"]
    from microtrace_core.results import AGGREGATION_RULE_FR
    assert body["aggregation_rule"] == AGGREGATION_RULE_FR


def test_report_content(client, auth_headers):
    r = client.post("/report", headers=auth_headers, json=_req())
    assert r.status_code == 200
    md = r.json()["markdown"]
    for needle in ("SIMULÉ", SHA, RULES_VERSION, "11/22", "## Limites",
                   "sur valeurs quantifiées uniquement", "Prototype de recherche"):
        assert needle in md
    from microtrace_core.results import AGGREGATION_RULE_FR
    assert AGGREGATION_RULE_FR in md
    assert "Attention : règles de contrôle différentes" not in md
    order = ["Versions", "Étude et référence", "Méthodes", "Imports", "Règle d'agrégation",
             "Fréquences", "Statistiques", "Contrôles qualité", "Issues", "Limites"]
    pos = [md.index("## " + o) for o in order]
    assert pos == sorted(pos)


def test_report_html_safe(client, auth_headers):
    body = _req()
    body["study"]["title"] = "Étude <b>x</b>"
    h = client.post("/report", headers=auth_headers, json=body).json()["html"]
    assert "<script" not in h and "http://" not in h and "https://" not in h
    assert "<b>x</b>" not in h and "&lt;b&gt;x&lt;/b&gt;" in h
    assert "<style>" in h


def test_to_html_escapes_everything():
    h = to_html("# <img onerror=1>\n\n| a |\n| --- |\n| <script>x</script> |\n", "<t>")
    assert "<script>" not in h and "<img" not in h


def test_rules_version_warning(client, auth_headers):
    body = _req(imports=[_imp("1"), _imp("2", "b.csv")])
    md = client.post("/report", headers=auth_headers, json=body).json()["markdown"]
    assert "Attention : règles de contrôle différentes entre imports" in md
    body = _req(imports=[_imp("0-ancienne")])
    md = client.post("/report", headers=auth_headers, json=body).json()["markdown"]
    assert "Attention : règles de contrôle différentes entre imports" in md


def test_invalid_input_french_422(client, auth_headers):
    r = client.post("/report", headers=auth_headers, json={"study": {}})
    assert r.status_code == 422 and "invalide" in r.json()["detail"]


def test_dictionary(client, auth_headers):
    body = client.get("/dictionary", headers=auth_headers).json()
    assert body["csv"] and body["markdown"].startswith("# Dictionnaire")


def test_example(client, auth_headers):
    body = client.get("/examples/leslie-like", headers=auth_headers).json()
    assert base64.b64decode(body["csv_base64"]) == leslie_like_csv()
    assert body["filename"] == LESLIE_LIKE_FILENAME
    assert body["context"]["data_nature"] == "simulated"
    assert body["mapping"]["mode"] == "wide"


def test_secret_required(client):
    assert client.get("/dictionary").status_code == 401
    assert client.post("/summary", json={"records": []}).status_code == 401


HOSTILE = "a|b\\c\n**d** # `e` <script>x</script> [l](javascript:alert(1))"


def _hostile_req():
    body = _req()
    body["study"]["title"] = HOSTILE
    body["study"]["license"] = HOSTILE
    body["context"]["methods"][0]["name"] = HOSTILE
    body["context"]["limits"][0]["source"] = HOSTILE
    body["context"]["limits"][0]["method"] = HOSTILE
    imp = _imp(name=HOSTILE)
    imp["file"]["sheet"] = HOSTILE
    imp["author"] = HOSTILE
    imp["issues"] = [{"code": "X", "severity": "warning", "message": HOSTILE}]
    body["imports"] = [imp]
    return body


def test_hostile_text_is_inert(client, auth_headers):
    out = client.post("/report", headers=auth_headers, json=_hostile_req()).json()
    md, h = out["markdown"], out["html"]
    for text in (md, h):
        assert "<script" not in text and "](javascript:" not in text
        assert "`" not in text
    assert "&lt;script&gt;" in h  # visible literally
    assert "&amp;lt;" not in h  # no double escaping
    assert "<strong>d</strong>" not in h
    # every table row keeps its column count
    import re
    for block in re.findall(r"(?:^\|.*\n)+", md, flags=re.M):
        counts = {ln.count("|") for ln in block.strip().split("\n")}
        assert len(counts) == 1, block
    for tr in re.findall(r"<table>.*?</table>", h):
        head = tr.count("<th>")
        assert all(r.count("<td>") == head for r in re.findall(r"<tr>(?:<td>.*?)</tr>", tr))


def test_counters_derived_from_issues(client, auth_headers):
    body = _req()
    body["imports"][0]["counts"] = {"error": 0, "warning": 0, "info": 0}
    body["imports"][0]["issues"] = [
        {"code": "X", "severity": "error", "message": "m"},
        {"code": "X", "severity": "error", "message": "m"}]
    md = client.post("/report", headers=auth_headers, json=body).json()["markdown"]
    assert "| 2 | 0 | 0 |" in md
    del body["imports"][0]["counts"]
    assert client.post("/report", headers=auth_headers, json=body).status_code == 200


def test_french_labels(client, auth_headers):
    md = client.post("/report", headers=auth_headers, json=_req()).json()["markdown"]
    assert "simulée" in md and "sang total" in md and "inconnu" in md
    for code in ("whole_blood", "mass_concentration", "py_gc_ms", "simulated"):
        assert code not in md
