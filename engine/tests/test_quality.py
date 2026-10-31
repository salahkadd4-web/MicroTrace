import json

from microtrace_core.results import (
    LESLIE_2022_FILENAME,
    leslie_2022_context,
    leslie_2022_csv,
    leslie_2022_mapping,
    leslie_like_context,
    leslie_like_mapping,
    run_import,
)
from microtrace_core.results.examples import leslie_like_wide_table
from microtrace_core.results.tables import read_table

from microtrace_engine import convert

SHA = "a" * 64
DUPLICATE = "Mesures en double dans la requête (même fichier, feuille, ligne et colonne)."


def _identified(records, sha=SHA):
    out = []
    for x in records:
        d = convert.record_to_model(x).model_dump()
        d.update(import_id="imp-1", file_sha256=sha, sheet="")
        out.append(d)
    return out


def _fictive(sha=SHA):
    table = leslie_like_wide_table()
    result = run_import(table, leslie_like_mapping(table), leslie_like_context())
    return _identified(result.records, sha)


def _post(client, auth_headers, records, **extra):
    return client.post("/quality", headers=auth_headers, json={"records": records, **extra})


BLANK = {"id": "qc1", "polymer": "PET", "kind": "procedural_blank", "n": 3, "mean": 250,
         "unit_code": "ng/mL", "source": "carnet-secret-42"}


def test_quality_fictive_contract(client, auth_headers):
    r = _post(client, auth_headers, _fictive())
    assert r.status_code == 200
    body = r.json()
    assert body["quality_rules_version"] == "q1"
    sig = body["signals"]
    assert len(sig) == 4
    assert {s["category"] for s in sig} == {"replicates", "distribution"}
    assert [s["title"] for s in sig] == [
        "Discordance entre aliquotes", "Discordance entre aliquotes",
        "Valeur atypique", "Valeur atypique"]
    text = [s["explanation"] for s in sig]
    assert "écart relatif 55,9 %" in text[0]
    assert "écart relatif 59,5 %" in text[1]
    assert "score z modifié 20,57" in text[2]
    assert "score z modifié 7,42" in text[3]
    assert [s["subject_label"] for s in sig] == [
        "Échantillon 16", "Échantillon 12", "Échantillon 16", "Échantillon 4"]
    assert all(len(s["key"]) == 64 for s in sig)
    assert len(body["rules"]) == 4
    assert all(rule["title"] and rule["description"] and rule["limits"] for rule in body["rules"])
    notes = body["notes"]
    assert len(notes) == 5
    joined = " | ".join(n["message"] for n in notes)
    for needle in ("blanc de procédure", "PMMA", "le lot n'est renseigné pour aucune mesure"):
        assert needle in joined


def test_quality_fictive_with_blank(client, auth_headers):
    plain = _post(client, auth_headers, _fictive()).json()
    r = _post(client, auth_headers, _fictive(), qc_summaries=[BLANK])
    assert r.status_code == 200
    body = r.json()
    assert len(body["signals"]) == 10
    near = [s for s in body["signals"] if s["rule"] == "near_blank"]
    assert ("0,45 µg/mL, soit 1,8 fois la moyenne des blancs de procédure "
            "(250 ng/mL, soit 0,25 µg/mL ; n = 3)") in near[0]["explanation"]
    assert {s["key"] for s in plain["signals"]} <= {s["key"] for s in body["signals"]}


def test_quality_blank_corrected_sentence(client, auth_headers):
    def first(blank_corrected):
        body = _post(client, auth_headers, _fictive(), qc_summaries=[BLANK],
                     blank_corrected=blank_corrected).json()
        return next(s for s in body["signals"] if s["rule"] == "near_blank")["explanation"]

    assert "valeur déjà corrigée du blanc" in first("yes")
    assert "valeur déjà corrigée du blanc" not in first("no")


def _lot_case():
    """Lot A: 9 of 10 below the LOD, one between LOD and LOQ; lot B: 3 of 20 below the LOD."""
    base = _fictive()[0]
    out = []
    for i in range(30):
        batch = "A" if i < 10 else "B"
        rec = dict(base)
        rec.update(sample_id=f"L{i}", aliquot="a", polymer="PET", batch=batch,
                   source_row=1000 + i, source_column="PET")
        if (batch == "A" and i < 9) or (batch == "B" and i - 10 < 3):
            rec.update(status="below_lod", value=None, canonical_value=None)
        elif i == 9:
            rec.update(status="between_lod_loq", value=0.2, canonical_value=0.2)
        else:
            rec.update(status="quantified", value=1.0 + i / 100, canonical_value=1.0 + i / 100)
        out.append(rec)
    return out


def test_quality_censored_refs_are_null(client, auth_headers):
    body = _post(client, auth_headers, _lot_case()).json()
    lod = [s for s in body["signals"] if s["rule"] == "unusual_lod_rate"]
    assert len(lod) == 1
    s = lod[0]
    assert s["subject_label"] == "Lot A"
    assert "9/10 mesures < LOD (90 %), contre 3/20 (15 %) dans les autres lots" in s["explanation"]
    assert len(s["records"]) == 10
    for ref in s["records"]:
        if ref["status"] != "quantified":
            assert ref["canonical_value"] is None
    assert any(ref["status"] == "between_lod_loq" for ref in s["records"])


def test_quality_keys_stable_across_requests(client, auth_headers):
    recs = _fictive()
    a = _post(client, auth_headers, recs, qc_summaries=[BLANK]).json()
    other = _fictive(sha="b" * 64)
    for o in other:
        o["polymer"] = "PVC"
        o["polymer_raw"] = "pvc"
        o["source_column"] += " (autre)"
    mixed = list(reversed(recs)) + other
    b = _post(client, auth_headers, mixed, qc_summaries=[BLANK]).json()
    keys_a = {s["key"] for s in a["signals"]}
    assert keys_a <= {s["key"] for s in b["signals"]}
    again = _post(client, auth_headers, list(reversed(recs)), qc_summaries=[BLANK]).json()
    assert [s["key"] for s in again["signals"]] == [s["key"] for s in a["signals"]]


def test_quality_unknown_blank_unit_is_a_note(client, auth_headers):
    r = _post(client, auth_headers, _fictive(), qc_summaries=[{**BLANK, "unit_code": "furlong"}])
    assert r.status_code == 200
    body = r.json()
    assert not [s for s in body["signals"] if s["rule"] == "near_blank"]
    assert any("furlong" in n["message"] for n in body["notes"])


def test_quality_duplicate_identity_422(client, auth_headers):
    recs = _fictive()
    r = _post(client, auth_headers, recs + [dict(recs[0], import_id="imp-2")])
    assert r.status_code == 422
    assert r.json()["detail"] == DUPLICATE


def test_quality_leslie_2022(client, auth_headers):
    table = read_table(leslie_2022_csv(), LESLIE_2022_FILENAME)
    result = run_import(table, leslie_2022_mapping(table), leslie_2022_context())
    body = _post(client, auth_headers, _identified(result.records)).json()
    assert len(body["signals"]) == 3
    text = " ".join(s["explanation"] for s in body["signals"])
    assert "écart relatif 120 %" in text and "score z modifié 3,51" in text


def test_quality_figures_are_exact_core_numbers(client, auth_headers):
    body = _post(client, auth_headers, _fictive(), qc_summaries=[BLANK]).json()
    near = next(s for s in body["signals"] if s["rule"] == "near_blank")
    figs = {f["name"]: f for f in near["figures"]}
    assert figs["ratio"]["value"] == 1.8 and figs["ratio"]["unit"] is None
    assert figs["blank_mean"]["unit"] == "ug/mL"
    assert figs["blank_mean_reported"]["unit"] == "ng/mL"
    assert all(f["label"] for f in near["figures"])
    assert json.dumps(body)


# ------------------------------------------------ display rounding never contradicts the rule

def test_vs_threshold_ratio_never_shows_the_threshold():
    from microtrace_engine.quality_text import _vs_threshold
    assert _vs_threshold(2.96, 1, 3.0, above=False) == "2,96"
    assert _vs_threshold(2.5, 1, 3.0, above=False) == "2,5"
    assert _vs_threshold(1.8, 1, 3.0, above=False) == "1,8"


def test_vs_threshold_rpd_z_and_p():
    from microtrace_engine.quality_text import _vs_threshold, _z
    assert _vs_threshold(50.016, 1, 50.0, above=True) == "50,02"
    assert _vs_threshold(55.93, 1, 50.0, above=True) == "55,9"
    assert _z(3.502, 3.5) == "3,502"
    assert _z(-3.502, 3.5) == "-3,502"
    assert _z(20.5678, 3.5) == "20,57"
    assert _vs_threshold(0.00999, 2, 0.01, above=False, significant=True) == "0,00999"
    assert _vs_threshold(0.0031, 2, 0.01, above=False, significant=True) == "0,0031"


def test_explanations_never_contradict_the_threshold(client, auth_headers):
    # ratio 2.96: 0.74 ug/mL against a 250 ng/mL blank
    recs = _fictive()
    base = next(r for r in recs if r["status"] == "quantified" and r["polymer"] == "PET")
    near = dict(base, sample_id="N1", aliquot="a", value=0.74, canonical_value=0.74,
                source_row=5000)
    body = _post(client, auth_headers, [near], qc_summaries=[BLANK]).json()
    sig = next(s for s in body["signals"] if s["rule"] == "near_blank")
    assert "soit 2,96 fois" in sig["explanation"]
    assert "soit 3 fois" not in sig["explanation"]
