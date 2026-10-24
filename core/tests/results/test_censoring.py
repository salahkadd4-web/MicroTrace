import pytest

from microtrace_core.results.censoring import (
    infer_status,
    parse_declared_status,
    parse_reported_value,
)


@pytest.mark.parametrize("text,value,hint,bound", [
    ("1.2", 1.2, None, None), ("1,2", 1.2, None, None), ("<LOD", None, "below_lod", None),
    ("n.d.", None, "below_lod", None), ("<LOQ", None, "not_quantified", None),
    ("< 0,68", None, None, 0.68), ("*1.2", 1.2, "between_lod_loq", None),
    ("1.2*", 1.2, "between_lod_loq", None),
    ("", None, "not_analysed", None), ("\xa02.4\xa0", 2.4, None, None),
    ("-3", -3.0, None, None), ("Not Detected", None, "below_lod", None),
    ("non détecté", None, "below_lod", None), ("N/A", None, "not_analysed", None)])
def test_parse_reported_value(text, value, hint, bound):
    r = parse_reported_value(text)
    assert r.ok and r.value == value and r.bound == bound and (r.hint == hint)


def test_parse_reported_value_decimal_comma():
    assert parse_reported_value("0,13").value == pytest.approx(0.13)


@pytest.mark.parametrize("text", ["abc", "1.2.3", "1 000", "<", "**"])
def test_parse_reported_value_unreadable(text):
    assert parse_reported_value(text).ok is False


@pytest.mark.parametrize("text,lod,loq,status", [
    ("2.4", 0.13, 0.43, "quantified"), ("0.2", 0.13, 0.43, "between_lod_loq"),
    ("0.05", 0.13, 0.43, "below_lod"), ("<0.13", 0.13, 0.43, "below_lod"),
    ("<0.43", 0.13, 0.43, "not_quantified"), ("*0.3", 0.13, 0.43, "between_lod_loq"),
    ("2.4", None, None, None), ("2.4", 0.13, None, None), ("<LOD", None, None, "below_lod")])
def test_infer_status(text, lod, loq, status):
    s = infer_status(parse_reported_value(text), lod, loq)
    assert (s.value if s else None) == status


@pytest.mark.parametrize("text,status", [
    ("quantified", "quantified"), (">LOQ", "quantified"), ("Q", "quantified"),
    ("lod-loq", "between_lod_loq"), ("LOD–LOQ", "between_lod_loq"),
    ("<LOQ", "not_quantified"), ("not_quantified", "not_quantified"),
    ("<LOD", "below_lod"), ("ND", "below_lod"), ("NA", "not_analysed"),
    ("not_analysed", "not_analysed"), ("zzz", None)])
def test_parse_declared_status(text, status):
    s = parse_declared_status(text)
    assert (s.value if s else None) == status
