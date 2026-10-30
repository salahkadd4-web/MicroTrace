import base64
import html

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
            "rules_version": rules, "date": "2026-10-25", "author": "Test", "issues": []}


def _req(**over):
    r = _result()
    recs = [convert.record_to_model(x).model_dump() for x in r.records]
    body = {"study": {"title": "Étude fictive"},
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


def test_report_polymer_labels_like_screen(client, auth_headers):
    md = client.post("/report", headers=auth_headers, json=_req()).json()["markdown"]
    assert "| PS (somme) |" in md
    assert "| Au moins un polymère |" in md
    assert "PS_SUM" not in md and "| ANY |" not in md and "au moins un polymère" not in md
    assert "| PET |" in md


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


DIFFER = ("Les imports actifs ont été contrôlés avec des versions de règles différentes entre "
          "imports : les statuts ne sont pas forcément comparables.")
OLDER = ("Les imports ont été contrôlés avec une version antérieure des règles : les statuts "
         "restent ceux calculés lors de chaque import.")


def test_rules_version_warnings(client, auth_headers):
    def md_of(**kw):
        return client.post("/report", headers=auth_headers, json=_req(**kw)).json()["markdown"]
    md = md_of(imports=[_imp("1"), _imp("2", "b.csv")])
    lines = md.split(chr(10))
    assert f"> **{DIFFER}**" in lines and OLDER not in md
    assert lines.index(f"> **{DIFFER}**") < lines.index("## Versions")
    md = md_of(imports=[_imp("0-ancienne")])  # one import, older rules: not "between imports"
    assert f"> **{OLDER}**" in md.split(chr(10)) and DIFFER not in md
    md = md_of()
    assert DIFFER not in md and OLDER not in md


def test_import_date_rendered_like_generated_at(client, auth_headers):
    imp = _imp()
    imp["date"] = "2026-10-30T09:15:42.123Z"
    md = client.post("/report", headers=auth_headers, json=_req(imports=[imp])).json()["markdown"]
    assert "30/10/2026 09:15 UTC" in md and "09:15:42" not in md
    imp["date"] = "2026-10-30T11:15:00+02:00"
    md = client.post("/report", headers=auth_headers, json=_req(imports=[imp])).json()["markdown"]
    assert "30/10/2026 09:15 UTC" in md
    imp["date"] = "pas une date"
    assert client.post("/report", headers=auth_headers, json=_req(imports=[imp])).status_code == 422


def test_labels_match_web(client, auth_headers):
    from microtrace_core.results.vocab import label_fr
    assert label_fr("kind", "number_concentration") == "concentration en nombre"
    assert label_fr("matrix", "other") == "autre matrice"


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


def test_example_leslie_2022(client, auth_headers):
    from microtrace_core.results.examples import LESLIE_2022_DOI, leslie_2022_csv

    r = client.get("/examples/leslie-2022", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["filename"] == "leslie2022_tableau_S2.csv"
    assert base64.b64decode(body["csv_base64"]) == leslie_2022_csv()
    assert body["context"]["data_nature"] == "published"
    assert body["context"]["reference_doi"] == LESLIE_2022_DOI
    assert body["mapping"]["mode"] == "wide"
    assert client.get("/examples/leslie-2022").status_code == 401


def test_secret_required(client):
    assert client.get("/dictionary").status_code == 401
    assert client.post("/summary", json={"records": []}).status_code == 401


HOSTILE = "a|b\\c\n**d** # `e` <script>x</script> [l](javascript:alert(1))"


def _hostile_req():
    body = _req()
    body["study"]["title"] = HOSTILE
    body["context"]["reference_license"] = HOSTILE
    body["context"]["methods"][0]["name"] = HOSTILE
    body["context"]["limits"][0]["source"] = HOSTILE
    body["context"]["limits"][0]["method"] = HOSTILE
    imp = _imp(name=HOSTILE)
    imp["file"]["sheet"] = HOSTILE
    imp["author"] = HOSTILE
    imp["issues"] = [{"code": "W_NO_LIMITS", "severity": "warning", "message": HOSTILE}]
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
    body["imports"][0]["issues"] = [
        {"code": "E_DUPLICATE_RECORD", "severity": "error", "message": "m"},
        {"code": "E_DUPLICATE_RECORD", "severity": "error", "message": "m"}]
    md = client.post("/report", headers=auth_headers, json=body).json()["markdown"]
    assert "| 2 | 0 | 0 |" in md
    # counters are not part of the contract any more
    body["imports"][0]["counts"] = {"error": 0, "warning": 0, "info": 0}
    assert client.post("/report", headers=auth_headers, json=body).status_code == 422


def test_french_labels(client, auth_headers):
    md = client.post("/report", headers=auth_headers, json=_req()).json()["markdown"]
    assert "simulée" in md and "sang total" in md and "inconnu" in md
    for code in ("whole_blood", "mass_concentration", "py_gc_ms", "simulated"):
        assert code not in md


def test_study_reference_comes_from_context_only(client, auth_headers):
    body = _req()
    body["study"]["nature"] = "published"
    assert client.post("/report", headers=auth_headers, json=body).status_code == 422
    body = _req()  # simulated context: banner whatever else is sent
    body["context"].update(reference_doi="10.1234/abc", reference_license="CC-BY-4.0",
                           blank_corrected="yes")
    md = client.post("/report", headers=auth_headers, json=body).json()["markdown"]
    assert "SIMULÉ" in md and "simulée" in md
    assert "10.1234/abc" in md and "CC-BY-4.0" in md and "Correction du blanc : oui" in md
    body["context"]["data_nature"] = "laboratory"
    md = client.post("/report", headers=auth_headers, json=body).json()["markdown"]
    assert "SIMULÉ" not in md and "laboratoire" in md


def test_any_and_unit_labels(client, auth_headers):
    md = client.post("/report", headers=auth_headers, json=_req()).json()["markdown"]
    assert "| Au moins un polymère | sang total |" in md and "ANY" not in md
    limits = md[md.index("| Méthode | Polymère | LOD"):md.index("## Imports")]
    assert "µg/mL" in limits and "ug/mL" not in limits


def test_generated_at_datetime(client, auth_headers):
    body = _req(generated_at="2026-10-25T14:03:00+02:00")
    md = client.post("/report", headers=auth_headers, json=body).json()["markdown"]
    assert "Rapport généré le 25/10/2026 12:03 UTC" in md
    body = _req(generated_at="2026-10-25T09:30:00")  # naive: taken as UTC
    md = client.post("/report", headers=auth_headers, json=body).json()["markdown"]
    assert "Rapport généré le 25/10/2026 09:30 UTC" in md
    md = client.post("/report", headers=auth_headers, json=_req()).json()["markdown"]
    import re
    assert re.search(r"Rapport généré le \d\d/\d\d/\d{4} \d\d:\d\d UTC", md)
    r = client.post("/report", headers=auth_headers, json=_req(generated_at="hier"))
    assert r.status_code == 422


CONTEXT_CHANGED = ("Les paramètres de l'étude (méthodes ou limites) ont changé depuis certains "
                   "imports : les statuts restent ceux calculés lors de chaque import.")


def test_context_changed_flag(client, auth_headers):
    at = "2026-10-25T12:00:00Z"
    base = client.post("/report", headers=auth_headers, json=_req(generated_at=at)).json()
    false = client.post("/report", headers=auth_headers,
                        json=_req(generated_at=at, context_changed=False)).json()
    assert false == base
    assert CONTEXT_CHANGED not in base["markdown"]
    on = client.post("/report", headers=auth_headers, json=_req(generated_at=at, context_changed=True)).json()
    lines = on["markdown"].split("\n")
    assert f"> **{CONTEXT_CHANGED}**" in lines
    assert lines.index(f"> **{CONTEXT_CHANGED}**") < lines.index("## Versions")
    esc = html.escape(CONTEXT_CHANGED, quote=True)
    assert f"<blockquote><strong>{esc}</strong></blockquote>" in on["html"]
    assert on["html"].index(esc) < on["html"].index("<h2>Versions</h2>")


def test_number_display_rules_mirrored_by_the_screen():
    """web/src/components/app/__tests__/NumberFr.test.tsx checks the same cases."""
    from microtrace_core.results.issues import fmt_fr
    pct = lambda x: fmt_fr(round(x * 100, 1))  # noqa: E731 (as in report.py)
    assert [pct(1 / 16), pct(5 / 16), pct(0.5), pct(1)] == ["6,2", "31,2", "50", "100"]
    assert [fmt_fr(v) for v in (1.8433333, 1234.56789, 1234567, 0.00001234)] == [
        "1,84333", "1234,57", "1234567", "0,00001234"]
