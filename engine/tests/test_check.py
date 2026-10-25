import json
import logging

import pytest
from microtrace_core.results import (
    leslie_like_context,
    leslie_like_csv,
    leslie_like_mapping,
    run_import,
)
from microtrace_core.results.examples import leslie_like_wide_table

from microtrace_engine import convert


@pytest.fixture(scope="module")
def expected():
    return run_import(leslie_like_wide_table(), leslie_like_mapping(), leslie_like_context())


def _form(**over):
    form = {
        "mapping": convert.mapping_to_model(leslie_like_mapping()).model_dump_json(),
        "context": convert.context_to_model(leslie_like_context()).model_dump_json(),
    }
    form.update(over)
    return form


def _post(client, headers, existing=None, file=("leslie.csv", leslie_like_csv()), **over):
    """``existing`` (JSON text) is sent as a file part, as the contract requires."""
    files = {"file": file}
    if existing is not None:
        files["existing"] = ("existing.json", existing.encode("utf-8"), "application/json")
    return client.post("/imports/check", headers=headers, files=files, data=_form(**over))


def _existing(records, **kw):
    out = []
    for r in records:
        d = dict(sample_id=r.sample_id, aliquot=r.aliquot, record_type=r.record_type.value,
                 polymer=r.polymer, polymer_raw=r.polymer_raw, method=r.method,
                 matrix=r.matrix.value, matrix_detail=r.matrix_detail)
        d.update(kw)
        out.append(d)
    return out


def test_requires_secret(client):
    r = client.post("/imports/check", files={"file": ("a.csv", b"x")}, data=_form())
    assert r.status_code == 401


def test_no_existing(client, auth_headers, expected):
    body = _post(client, auth_headers).json()
    assert body["has_errors"] is False
    assert len(body["records"]) == len(expected.records) > 0
    assert body["counts"]["error"] == 0


def test_existing_own_keys_all_duplicates(client, auth_headers, expected):
    ex = json.dumps(_existing(expected.records))
    body = _post(client, auth_headers, existing=ex).json()
    assert body["has_errors"] is True
    assert body["records"] == [] and body["qc_records"] == []
    dups = [i for i in body["issues"] if i["code"] == "E_DUPLICATE_RECORD"]
    assert len(dups) == len(expected.records)
    assert body["counts"]["error"] == len(dups)


def test_sample_conflict_once(client, auth_headers, expected):
    sid = expected.records[0].sample_id
    ex = json.dumps(_existing([expected.records[0]], matrix="plasma", aliquot="zz"))
    body = _post(client, auth_headers, existing=ex).json()
    conflicts = [i for i in body["issues"] if i["code"] == "E_SAMPLE_CONFLICT"
                 and f"« {sid} »" in i["message"]]
    assert len(conflicts) == 1
    assert body["has_errors"] and body["records"] == []


def test_other_sample_no_issue(client, auth_headers, expected):
    ex = json.dumps(_existing(expected.records[:1], sample_id="zzz"))
    body = _post(client, auth_headers, existing=ex).json()
    assert body["has_errors"] is False
    assert len(body["records"]) == len(expected.records)


def test_invalid_context_422(client, auth_headers):
    ctx = convert.context_to_model(leslie_like_context())
    bad = ctx.model_copy(update={"methods": ctx.methods * 2}).model_dump_json()
    r = _post(client, auth_headers, context=bad)
    assert r.status_code == 422 and "deux fois" in r.json()["detail"]


@pytest.mark.parametrize("field", ["mapping", "context", "existing"])
def test_malformed_json_422(client, auth_headers, field):
    r = _post(client, auth_headers, **{field: "{secret-cell-value"})
    assert r.status_code == 422
    assert field in r.json()["detail"]
    assert "secret-cell-value" not in r.text


def test_schema_violation_422(client, auth_headers):
    r = _post(client, auth_headers, mapping='{"mode": "bogus"}')
    assert r.status_code == 422 and "mapping" in r.json()["detail"]


def test_no_logging_of_content(client, auth_headers, caplog):
    with caplog.at_level(logging.DEBUG):
        _post(client, auth_headers, existing='[{"sample_id": "PRIVATE-ID"}]')
    assert "PRIVATE-ID" not in caplog.text


def test_existing_other_without_raw_422(client, auth_headers, expected):
    bad = _existing(expected.records[:1], polymer="OTHER", polymer_raw="")
    r = _post(client, auth_headers, existing=json.dumps(bad))
    assert r.status_code == 422 and "existing" in r.json()["detail"]


def test_cross_import_issues_located_on_sample_column(client, auth_headers, expected):
    ex = json.dumps(_existing(expected.records[:1]))
    body = _post(client, auth_headers, existing=ex).json()
    dup = [i for i in body["issues"] if i["code"] == "E_DUPLICATE_RECORD"]
    assert [(i["column"], i["field"]) for i in dup] == [("Donor", "sample_id")]


def test_result_carries_file_identity(client, auth_headers):
    import hashlib

    body = _post(client, auth_headers).json()
    from importlib.metadata import version

    assert body["sha256"] == hashlib.sha256(leslie_like_csv()).hexdigest()
    assert body["sheet"] is None
    assert body["engine_version"] == version("microtrace-engine")


def test_existing_above_one_megabyte(client, auth_headers, expected):
    keys = _existing(expected.records[:1]) * 12000
    keys = [dict(k, sample_id=f"ZZ-{n:06d}") for n, k in enumerate(keys)]
    text = json.dumps(keys)
    assert len(text) > 1024 * 1024
    r = _post(client, auth_headers, existing=text)
    assert r.status_code == 200 and r.json()["has_errors"] is False


def test_existing_bounded(client, auth_headers, expected, monkeypatch):
    from microtrace_engine import app as app_module

    monkeypatch.setattr(app_module, "EXISTING_MAX_BYTES", 100)
    r = _post(client, auth_headers, existing=json.dumps(_existing(expected.records[:5])))
    assert r.status_code == 422
    assert "existing" in r.json()["detail"] and "Mo" in r.json()["detail"]


def test_existing_as_text_field_refused(client, auth_headers):
    r = client.post("/imports/check", headers=auth_headers,
                    files={"file": ("leslie.csv", leslie_like_csv())},
                    data=_form(existing="[]"))
    assert r.status_code == 422
    assert {"loc": ["body", "existing"]}.items() <= r.json()["errors"][0].items()


QC_CSV = ("sample_id;matrix;polymer;reported_value;unit;method;record_type\n"
          "S1;sang total;PET;1,5;µg/mL;Py-GC/MS;sample\n"
          "BLK1;sang total;PET;0,2;µg/mL;Py-GC/MS;procedural_blank\n").encode("utf-8")
QC_MAPPING = json.dumps({"mode": "long", "field_columns": {
    k: k for k in ("sample_id", "matrix", "polymer", "reported_value", "unit", "method",
                   "record_type")}})


def test_qc_only_collision_empties_qc_records(client, auth_headers):
    clean = _post(client, auth_headers, file=("qc.csv", QC_CSV), mapping=QC_MAPPING).json()
    assert clean["has_errors"] is False
    assert len(clean["records"]) == 1 and len(clean["qc_records"]) == 1
    blk = clean["qc_records"][0]
    ex = json.dumps([{k: blk[k] for k in ("sample_id", "aliquot", "record_type", "polymer",
                                         "polymer_raw", "method", "matrix", "matrix_detail")}])
    body = _post(client, auth_headers, existing=ex, file=("qc.csv", QC_CSV),
                 mapping=QC_MAPPING).json()
    assert body["has_errors"] is True
    assert body["records"] == [] and body["qc_records"] == []
    assert [i["code"] for i in body["issues"] if i["severity"] == "error"] == [
        "E_DUPLICATE_RECORD"]
