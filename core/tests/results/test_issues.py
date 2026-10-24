"""Issue contract: every code is registered with one severity (all data simulated)."""
import re
from dataclasses import replace
from pathlib import Path

import pytest

import microtrace_core.results as results
from microtrace_core.results.importer import run_import
from microtrace_core.results.issues import ISSUE_CODES, Issue, fmt_fr
from microtrace_core.results.mapping import Mapping, apply_mapping
from microtrace_core.results.privacy import detect_pii
from microtrace_core.results.tables import RawTable

from .conftest import PYGC, UG_ML, leslie_like_context, leslie_like_mapping, leslie_like_wide_table

_CODE = re.compile(r"\b[EWI]_[A-Z0-9_]+\b")
_PREFIX = {"E": "error", "W": "warning", "I": "info"}


def _table(columns, rows):
    rs = tuple(dict(zip(columns, r, strict=True)) for r in rows)
    return RawTable(tuple(columns), rs, tuple(range(2, 2 + len(rs))), "simulated.csv", None)


def test_issue_codes_match_package_source():
    package = Path(results.__file__).parent
    found = {c for p in package.glob("*.py") for c in _CODE.findall(p.read_text(encoding="utf-8"))}
    assert found == set(ISSUE_CODES)


def test_issue_code_prefix_is_its_severity():
    assert all(_PREFIX[code[0]] == sev for code, sev in ISSUE_CODES.items())


def _corpus() -> list[Issue]:
    ctx = leslie_like_context()
    out: list[Issue] = []
    base = leslie_like_wide_table()
    out += run_import(base, leslie_like_mapping(), ctx).issues
    m = leslie_like_mapping()
    out += run_import(base, replace(m, constants={**m.constants, "unit": "ppm"}), ctx).issues
    dup = replace(base, rows=(*base.rows, dict(base.rows[4])), row_numbers=(*base.row_numbers, 42))
    out += run_import(dup, leslie_like_mapping(), ctx).issues
    cols = ["Sample", "Polymer", "Value", "Matrix", "Type", "Status", "LOD", "LOQ", "Ident",
            "Size", "Extra"]
    t = _table(cols, [
        ["", "PS", "abc", "urine", "zz", "zz", "x", "-1", "zz", "-1", "x"],
        ["S1", "polyzorglub", "-1", "autre", "sample", "below_lod", "0,5", "0,2", "", "", ""],
        ["S1", "polyzorglub", "1", "autre", "sample", "below_lod", "0,5", "0,2", "", "", ""],
        ["S2", "PET", "<1", "sang total", "sample", "", "", "", "", "", ""],
        ["S2", "PE", "0,01", "plasma", "procedural_blank", "", "0,1", "0,4", "", "", ""],
        ["S3", "PET", "*2", "sang total", "", "", "", "", "", "", ""],
        ["S4", "/", "1", "sang total", "", "quantified", "", "", "", "", ""],
    ])
    fields = {"sample_id": "Sample", "polymer": "Polymer", "reported_value": "Value",
              "matrix": "Matrix", "record_type": "Type", "detection_status": "Status",
              "lod": "LOD", "loq": "LOQ", "identification_status": "Ident", "size_min_um": "Size"}
    for method in (PYGC, "Mystère"):
        out += run_import(t, Mapping("long", fields, constants={"unit": UG_ML, "method": method}),
                          ctx).issues
    out += run_import(t, Mapping("long", fields, constants={"unit": "particles/mL", "method": PYGC}),
                      ctx).issues
    mixed = _table(["Sample", "Polymer", "Value", "Unit"],
                   [["S1", "PET", "1", UG_ML], ["S2", "PET", "3", "particles/mL"]])
    out += run_import(mixed, Mapping("long", {"sample_id": "Sample", "polymer": "Polymer",
                                              "reported_value": "Value", "unit": "Unit"},
                                     constants={"matrix": "plasma", "method": PYGC}),
                      replace(ctx, limits=(), data_nature="published")).issues
    out += detect_pii(_table(["Nom", "Code patient", "comment"],
                             [["x", "Jean Dupont", "a@b.fr 12/03/1985"]]), Mapping("long", {}))
    dated = _table(["Sample", "Polymer", "Value", "Date"],
                   [["S1", "PET", "", "05/06/2021"], ["S2", "PET", "1", "31/02/2021"]])
    out += run_import(dated, Mapping("long", {"sample_id": "Sample", "polymer": "Polymer",
                                              "reported_value": "Value", "analysis_date": "Date"},
                                     constants={"matrix": "plasma", "unit": UG_ML, "method": PYGC},
                                     split_aliquot_suffix=True), ctx).issues
    two = _table(["Sample", "PE", "PP", "V"], [["1", "1", "2", "3"]])
    for mapping in (Mapping("wide", {"sample_id": "Sample", "reported_value": "V"}, {"PE": "PE"}),
                    Mapping("wide", {"sample_id": "Sample"}),
                    Mapping("long", {"sample_id": "Nope", "zorg": "V"}, {"Q": "Q"}, {"bad": "1"})):
        out += apply_mapping(two, mapping)[1]
    return out


def test_every_emitted_issue_has_its_registered_severity():
    corpus = _corpus()
    assert {i.code for i in corpus} == set(ISSUE_CODES)
    for i in corpus:
        assert i.severity == ISSUE_CODES[i.code], i


def test_issue_field_and_column_contract():
    t = _table(["Sample", "Polymer", "Value"], [["S1", "PET", "abc"], ["S1", "PET", "1"]])
    m = Mapping("long", {"sample_id": "Sample", "polymer": "Polymer", "reported_value": "Value"},
                constants={"matrix": "plasma", "unit": "ppm", "method": PYGC})
    issues = run_import(t, m, leslie_like_context()).issues
    by = {(i.code, i.row): i for i in issues}
    assert (by["E_UNPARSABLE_VALUE", 2].field, by["E_UNPARSABLE_VALUE", 2].column) == (
        "reported_value", "Value")
    assert (by["E_UNKNOWN_UNIT", 2].field, by["E_UNKNOWN_UNIT", 2].column) == ("unit", None)
    assert (by["E_DUPLICATE_RECORD", 3].field, by["E_DUPLICATE_RECORD", 3].column) == (
        "sample_id", "Sample")
    assert Issue("X", "info", "m").field is None


def test_package_exports_the_b2_contract():
    for name in ("Issue", "has_errors", "ISSUE_CODES", "MeasurementRecord", "RawTable",
                 "TableReadError", "UnitMismatchError", "MappedRow", "Matrix", "Technique",
                 "QuantityKind", "Basis", "DetectionStatus", "RecordType", "IdentificationStatus",
                 "DataNature", "PS_SUM", "UNITS", "parse_unit", "canonical_unit", "STANDARD_FIELDS",
                 "SampleResult", "Frequency", "PolymerStats"):
        assert name in results.__all__ and hasattr(results, name), name



@pytest.mark.parametrize("value,text", [(0.13, "0,13"), (2.0, "2"), (1e-05, "0,00001"),
                                        (130.0, "130"), (1 / 3, "0,333333"), (1234567.0, "1234567"),
                                        (-0.5, "-0,5")])
def test_fmt_fr(value, text):
    assert fmt_fr(value) == text
