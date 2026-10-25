import asyncio
import hashlib
import io

import pytest
from microtrace_core.results import examples
from microtrace_core.results import tables as core_tables
from openpyxl import Workbook

CSV = "Échantillon;PE;PS\nS1;1,5;2,0\nS2;3,25;<LOD\n".encode()


def _post(client, headers, name, data, path="/tables/read", **form):
    return client.post(
        path, headers=headers, files={"file": (name, data)}, data=form
    )


def _xlsx() -> bytes:
    wb = Workbook()
    wb.active.title = "Feuil1"
    wb.active.append(["A", "B"])
    wb.active.append(["a1", "b1"])
    ws2 = wb.create_sheet("Feuil2")
    ws2.append(["C", "D"])
    ws2.append(["c1", "d1"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_read_csv(client, auth_headers):
    r = _post(client, auth_headers, "t.csv", CSV)
    assert r.status_code == 200
    body = r.json()
    assert body["filename"] == "t.csv"
    assert body["sha256"] == hashlib.sha256(CSV).hexdigest()
    assert body["size"] == len(CSV)
    assert body["sheets"] == [] and body["sheet"] is None
    assert body["columns"] == ["Échantillon", "PE", "PS"]
    assert body["n_rows"] == 2
    assert body["preview"][0] == {"Échantillon": "S1", "PE": "1,5", "PS": "2,0"}


def test_preview_capped_at_20(client, auth_headers):
    data = "A;B\n" + "".join(f"{i};x\n" for i in range(50))
    body = _post(client, auth_headers, "t.csv", data.encode()).json()
    assert body["n_rows"] == 50 and len(body["preview"]) == 20


def test_xlsx_sheets(client, auth_headers):
    data = _xlsx()
    body = _post(client, auth_headers, "t.xlsx", data).json()
    assert body["sheets"] == ["Feuil1", "Feuil2"] and body["sheet"] == "Feuil1"
    body = _post(client, auth_headers, "t.xlsx", data, sheet="Feuil2").json()
    assert body["sheet"] == "Feuil2" and body["columns"] == ["C", "D"]


def test_unknown_sheet_422(client, auth_headers):
    r = _post(client, auth_headers, "t.xlsx", _xlsx(), sheet="Nope")
    assert r.status_code == 422 and "introuvable" in r.json()["detail"]


def test_bad_xlsx_422(client, auth_headers):
    r = _post(client, auth_headers, "t.xlsx", b"not a zip")
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_unsupported_format_422(client, auth_headers):
    r = _post(client, auth_headers, "t.pdf", b"x")
    assert r.status_code == 422


def test_too_large_422_without_reading_everything(client, auth_headers, monkeypatch):
    from microtrace_engine import uploads

    monkeypatch.setattr(uploads, "MAX_BYTES", 100)
    monkeypatch.setattr(core_tables, "MAX_BYTES", 100)
    r = _post(client, auth_headers, "t.csv", b"a;b\n" + b"1;2\n" * 200)
    assert r.status_code == 422 and "volumineux" in r.json()["detail"]


def test_read_upload_stops_after_limit_plus_one():
    from microtrace_engine.uploads import TooLarge, read_upload

    class Fake:
        total = 0

        async def read(self, n=-1):
            assert n > 0
            self.total += n
            return b"x" * n

    f = Fake()
    with pytest.raises(TooLarge):
        asyncio.run(read_upload(f, 1000))
    assert f.total <= 1000 + 64 * 1024


def test_contact_header_hidden(client, auth_headers):
    data = "Échantillon;jean.dupont@chu.fr;PE\nS1;a;1\n".encode()
    r = _post(client, auth_headers, "t.csv", data)
    assert r.status_code == 200
    assert "jean.dupont" not in r.text
    assert r.json()["columns"][1] == "colonne n° 2"
    assert "colonne n° 2" in r.json()["preview"][0]
    r = _post(client, auth_headers, "t.csv", data, path="/mapping/suggest")
    assert r.status_code == 200 and "jean.dupont" not in r.text


def test_long_header_hidden(client, auth_headers):
    long = "L" * 1500
    data = f"{long};PE\nx;1\n".encode()
    r = _post(client, auth_headers, "t.csv", data)
    assert long not in r.text and r.json()["columns"][0] == "colonne n° 1"


def test_mapping_suggest_leslie(client, auth_headers):
    r = _post(client, auth_headers, examples.LESLIE_LIKE_FILENAME,
              examples.leslie_like_csv(), path="/mapping/suggest")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "wide" and len(body["polymer_columns"]) == 5


def test_requires_secret(client):
    r = client.post("/tables/read", files={"file": ("t.csv", CSV)})
    assert r.status_code == 401


def test_masked_names_unique(client, auth_headers):
    data = "Échantillon;jean.dupont@chu.fr;colonne n° 2;PE\nS1;secret;visible;1\n".encode()
    r = _post(client, auth_headers, "t.csv", data)
    body = r.json()
    assert "jean.dupont" not in r.text
    assert len(set(body["columns"])) == 4
    assert body["columns"][2] == "colonne n° 2"
    row = body["preview"][0]
    assert row["colonne n° 2"] == "visible" and "secret" in row.values()
    assert len(row) == 4


def test_polymer_with_contact_dropped(client, auth_headers):
    data = "Échantillon;PE jean@x.fr;PS\nS1;1;2\n".encode()
    r = _post(client, auth_headers, "t.csv", data, path="/mapping/suggest")
    assert r.status_code == 200 and "jean@x.fr" not in r.text
    assert all("jean" not in k for k in r.json()["polymer_columns"])
