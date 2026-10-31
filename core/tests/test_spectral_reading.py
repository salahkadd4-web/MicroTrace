from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from microtrace_core.spectral.libraries import LIBRARIES
from microtrace_core.spectral.matching import CorrelationMatcher, correlation_matrix
from microtrace_core.spectral.reading import (
    MAX_POINTS,
    ReadIssue,
    SpectrumReadError,
    parse_two_columns,
)

XS = [1000.0 + 10 * i for i in range(12)]
YS = [0.5 + i for i in range(12)]


def _render(sep: str, header: str | None = None, fmt=repr, trailer: str = "") -> bytes:
    lines = [header] if header else []
    lines += [f"{fmt(x)}{sep}{fmt(y)}{trailer}" for x, y in zip(XS, YS, strict=True)]
    return ("\n".join(lines) + "\n").encode()


FORMATS = {
    "flopp": _render(","),
    "slopp": _render("\t"),
    "mpx": _render(",", header="nm,Intensity"),
    "weathered": _render("   "),
    "semicolon": _render(";", fmt=lambda v: repr(v).replace(".", ",")),
}


def test_correlation_matrix_matches_matcher():
    rng = np.random.default_rng(0)
    R = rng.normal(size=(20, 50))
    R[rng.random(R.shape) < 0.3] = np.nan
    R[3, :40] = np.nan  # too little overlap: -inf
    Q = rng.normal(size=(5, 50))
    Q[rng.random(Q.shape) < 0.1] = np.nan
    M = correlation_matrix(Q, R)
    assert M.shape == (5, 20)
    res = CorrelationMatcher().fit(R, [f"l{i}" for i in range(20)],
                                   [f"id{i}" for i in range(20)]).predict(Q)
    assert np.array_equal(res.best_ids, np.array([f"id{i}" for i in M.argmax(axis=1)], dtype=object))
    assert np.array_equal(res.scores, M.max(axis=1))
    assert np.isneginf(M[:, 3]).all()


@pytest.mark.parametrize("name", list(FORMATS))
def test_parse_formats(name):
    x, y = parse_two_columns(FORMATS[name])
    assert len(x) == len(y) == 12
    assert x[0] == 1000.0 and y[0] == 0.5


def test_parse_comma_separator_keeps_dot_decimal():
    body = b"1000,0.5\n" + "".join(f"{1001 + i},0.5\n" for i in range(11)).encode()
    x, y = parse_two_columns(body)
    assert (x[0], y[0]) == (1000.0, 0.5)


def test_parse_accepts_bom_and_latin1_header():
    x, _ = parse_two_columns(b"\xef\xbb\xbf" + FORMATS["mpx"])
    assert len(x) == 12
    x, _ = parse_two_columns("Longueur d'onde é,Intensité\n".encode("latin-1") + FORMATS["flopp"])
    assert len(x) == 12


def _lines(n: int, row: str = "{i},{i}") -> bytes:
    return "".join(row.format(i=i + 1) + "\n" for i in range(n)).encode()


ERRORS = [
    (b"", ReadIssue.EMPTY, None, None),
    (b"\x00\x01", ReadIssue.BINARY, None, None),
    (b"##TITLE=x\n", ReadIssue.JCAMP, None, None),
    (b"a,b\n" * 3, ReadIssue.NO_NUMERIC_ROWS, None, None),
    (b"header line\n" * 51 + _lines(12), ReadIssue.TOO_MANY_HEADER_LINES, None, None),
    (_lines(6) + b"x,SECRET\n" + _lines(6), ReadIssue.NON_NUMERIC_ROW, 7, None),
    (b"1,2,3\n" + _lines(12), ReadIssue.TOO_MANY_COLUMNS, 1, None),
    (_lines(9), ReadIssue.TOO_FEW_POINTS, None, 9),
    (_lines(MAX_POINTS + 1), ReadIssue.TOO_MANY_POINTS, None, None),
]


@pytest.mark.parametrize("data,issue,line,count", ERRORS,
                         ids=[e[1].value for e in ERRORS])
def test_parse_errors(data, issue, line, count):
    with pytest.raises(SpectrumReadError) as info:
        parse_two_columns(data)
    err = info.value
    assert err.issue is issue
    if line is not None:
        assert err.line == line
    if count is not None:
        assert err.count == count


def test_parse_error_never_holds_content():
    with pytest.raises(SpectrumReadError) as info:
        parse_two_columns(_lines(6) + b"x,SECRET\n")
    assert "SECRET" not in str(info.value)
    assert all("SECRET" not in str(a) for a in info.value.args)


def test_library_codes_match_catalogue_sources():
    assert set(LIBRARIES) == {"mpx", "flopp", "flopp_e", "slopp", "slopp_e", "raspi",
                              "raman_weathered"}


SOURCES_MD = Path(__file__).resolve().parents[2] / "datasets" / "SOURCES.md"
ROW_MARKERS = {"mpx": "10.22000-1820", "flopp": "FLOPP / FLOPP-e", "flopp_e": "FLOPP / FLOPP-e",
               "slopp": "SLoPP / SLoPP-E", "slopp_e": "SLoPP / SLoPP-E", "raspi": "RaSPI —",
               "raman_weathered": "Base Raman de microplastiques vieillis"}


@pytest.mark.skipif(not SOURCES_MD.exists(), reason="datasets/SOURCES.md is absent")
def test_library_licences_follow_sources_md():
    rows = [line for line in SOURCES_MD.read_text(encoding="utf-8").splitlines()
            if line.startswith("|")]
    assert LIBRARIES["mpx"].licence == "CC BY-SA 4.0" and LIBRARIES["mpx"].curve_allowed
    for code, marker in ROW_MARKERS.items():
        row = next(r for r in rows if marker in r)
        licence_cell = [c.strip() for c in row.strip("|").split("|")][6]
        if "À compléter" in licence_cell:
            assert LIBRARIES[code].curve_allowed is False, code
        assert (LIBRARIES[code].licence is None) == ("À compléter" in licence_cell), code
