import pytest

from microtrace_core.results.units import (
    UNITS, UnitMismatchError, convert, parse_unit, to_canonical,
)
from microtrace_core.results.vocab import (
    IdentificationStatus, Matrix, Technique, default_identification,
    normalize_result_polymer, parse_matrix, parse_technique,
)


@pytest.mark.parametrize("text", ["µg/mL", "μg/mL", "ug/ml", "µg/ml", " UG/ML ", "µg mL-1", "µg·mL⁻¹"])
def test_parse_unit_micro_variants(text):
    assert parse_unit(text).code == "ug/mL"


@pytest.mark.parametrize("text,code", [("mg/L", "mg/L"), ("ng/mL", "ng/mL"), ("µg/L", "ug/L"),
    ("mg/kg", "mg/kg"), ("particles/mL", "particles/mL"), ("particules/mL", "particles/mL"),
    ("p/mL", "particles/mL"), ("MPs/L", "particles/L"), ("items/g", "particles/g")])
def test_parse_unit_codes(text, code):
    assert parse_unit(text).code == code


def test_parse_unit_unknown():
    assert parse_unit("ppm") is None and parse_unit("") is None


def test_convert_same_kind():
    assert convert(500.0, UNITS["ng/mL"], UNITS["ug/mL"]) == pytest.approx(0.5)
    assert to_canonical(2.0, UNITS["mg/L"]) == (2.0, UNITS["ug/mL"])


@pytest.mark.parametrize("a,b", [("ug/mL", "particles/mL"), ("ug/mL", "ug/g")])
def test_convert_refuses_other_kind_or_basis(a, b):
    with pytest.raises(UnitMismatchError):
        convert(1.0, UNITS[a], UNITS[b])


def test_ps_becomes_ps_sum_only_for_thermoanalytical():
    assert normalize_result_polymer("PS", Technique.py_gc_ms) == "PS_SUM"
    assert normalize_result_polymer("polystyrene", Technique.ted_gc_ms) == "PS_SUM"
    assert normalize_result_polymer("PS", Technique.micro_ftir) == "PS"


def test_parse_matrix_and_technique():
    assert parse_matrix("Sang total") is Matrix.whole_blood and parse_matrix("SÉRUM") is Matrix.serum
    assert parse_matrix("urine") is None
    assert parse_technique("Py-GC/MS") is Technique.py_gc_ms and parse_technique("µFTIR") is Technique.micro_ftir
    assert default_identification(Technique.other) is IdentificationStatus.candidate


@pytest.mark.parametrize("label", ["PS_SUM", "ps sum", "PS (sum)", "Styrenics", "Styréniques"])
@pytest.mark.parametrize("tech", [Technique.py_gc_ms, Technique.micro_ftir])
def test_ps_sum_labels(label, tech):
    assert normalize_result_polymer(label, tech) == "PS_SUM"


@pytest.mark.parametrize("value,src,dst,expected", [
    (500.0, "ng/mL", "ug/mL", 0.5), (130.0, "ng/mL", "ug/mL", 0.13), (9.0, "ng/mL", "ug/mL", 0.009),
    (43.0, "ug/L", "ug/mL", 0.043), (0.13, "ug/mL", "ng/mL", 130.0), (2500.0, "particles/L",
                                                                       "particles/mL", 2.5),
    (51.0, "ng/g", "ug/g", 0.051), (2.0, "mg/L", "ug/mL", 2.0)])
def test_conversions_are_exact_decimals(value, src, dst, expected):
    assert convert(value, UNITS[src], UNITS[dst]) == expected


def test_to_canonical_exact():
    assert to_canonical(9.0, UNITS["ng/mL"]) == (0.009, UNITS["ug/mL"])
