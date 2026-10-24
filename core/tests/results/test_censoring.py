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


@pytest.mark.parametrize("text,lod,loq,status", [
    ("0.2", None, 0.43, "not_quantified"), ("0.5", None, 0.43, "quantified"),
    ("<0.2", None, 0.43, "not_quantified"),
    ("0.05", 0.13, None, "below_lod"), ("0.5", 0.13, None, None),
    ("<0.1", 0.13, None, "below_lod"), ("<0.5", 0.13, None, None)])
def test_infer_status_partial_limits(text, lod, loq, status):
    s = infer_status(parse_reported_value(text), lod, loq)
    assert (s.value if s else None) == status


@pytest.mark.parametrize("text,value", [("1e-05", 1e-05), ("1,2E-3", 0.0012), ("2.5e+3", 2500.0),
                                        ("3E2", 300.0)])
def test_plain_numbers_with_exponent(text, value):
    r = parse_reported_value(text)
    assert r.ok and r.hint is None and r.value == pytest.approx(value)


@pytest.mark.parametrize("text", ["1e", "e5", "1e-", "1,2,E3"])
def test_bad_exponents_unreadable(text):
    assert parse_reported_value(text).ok is False


@pytest.mark.parametrize("text,status", [
    ("< LD", "below_lod"), ("< LQ", "not_quantified"), ("<  lod", "below_lod"),
    ("< LOQ", "not_quantified"), ("<\xa0LD", "below_lod")])
def test_spaces_after_lt_collapsed(text, status):
    assert parse_reported_value(text).hint == status


_REPORTED_NOTATIONS = ["<LOD", "< LOD", "<LD", "< LD", "ND", "n.d.", "n.d", "not detected",
                       "Non détecté", "<LOQ", "< LQ", "<LQ", "NA", "n/a", "not analysed",
                       "Not analyzed", "non analysé"]


@pytest.mark.parametrize("text", _REPORTED_NOTATIONS)
def test_declared_status_accepts_reported_notations(text):
    assert parse_declared_status(text) == parse_reported_value(text).hint is not None


@pytest.mark.parametrize("text,status", [
    ("below lod", "below_lod"), ("Below LOD", "below_lod"), ("not quantified", "not_quantified"),
    ("between lod loq", "between_lod_loq"), ("Between LOD-LOQ", "between_lod_loq"),
    ("LOD—LOQ", "between_lod_loq"), ("LOD – LOQ", "between_lod_loq"), ("> LOQ", "quantified"),
    ("not analysed", "not_analysed"), ("Not_Quantified", "not_quantified")])
def test_declared_status_more_notations(text, status):
    assert parse_declared_status(text) == status


# ---- residuals ----

_NON_FINITE = ["1e999", "-1e999", "1E400", "1,5e999", "inf", "-inf", "Inf", "INF", "infinity",
               "nan", "NaN", "NAN", "<1e999", "*1e999", "1e999*", pytest.param("<" + "9" * 400, id="lt-400-nines"),
               pytest.param("9" * 400, id="400-nines"), pytest.param("*" + "9" * 400, id="star-400-nines")]


@pytest.mark.parametrize("text", _NON_FINITE)
def test_non_finite_numbers_unreadable(text):
    r = parse_reported_value(text)
    assert (r.ok, r.value, r.bound, r.hint) == (False, None, None, None)


@pytest.mark.parametrize("text,value", [("1e308", 1e308), ("-1e-999", -0.0), ("1e-400", 0.0)])
def test_finite_extremes_stay_readable(text, value):
    r = parse_reported_value(text)
    assert r.ok and r.value == value
