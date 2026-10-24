import csv
import io

import pytest

from microtrace_core.results.records import DetectionLimit, MethodSpec, StudyContext
from microtrace_core.results.schema import (
    FIELD_NAMES,
    REQUIRED_FIELDS,
    STANDARD_FIELDS,
    data_dictionary_csv,
    data_dictionary_markdown,
)
from microtrace_core.results.units import UNITS
from microtrace_core.results.vocab import DataNature, Technique


def test_required_fields_exact():
    assert REQUIRED_FIELDS == {"sample_id", "matrix", "polymer", "reported_value", "unit", "method"}


def test_field_order_and_count():
    assert len(STANDARD_FIELDS) == 19
    assert FIELD_NAMES[:7] == ("sample_id", "matrix", "polymer", "reported_value", "unit",
                               "method", "aliquot")
    assert FIELD_NAMES[-1] == "comment"


def test_dictionary_csv_has_one_row_per_field():
    rows = list(csv.DictReader(io.StringIO(data_dictionary_csv())))
    assert len(rows) == 19
    assert list(rows[0]) == ["name", "label_fr", "type", "required", "description_fr", "allowed"]
    unit = next(r for r in rows if r["name"] == "unit")
    assert set(unit["allowed"].split("|")) == set(UNITS) and len(UNITS) == 10


def test_dictionary_markdown_title_and_fields():
    md = data_dictionary_markdown()
    assert md.startswith("# Dictionnaire de données — MicroTrace Studio")
    assert all(f"`{n}`" in md for n in FIELD_NAMES)


def test_study_context_rejects_bad_blank_corrected():
    m = (MethodSpec("PyGC", Technique.py_gc_ms),)
    with pytest.raises(ValueError):
        StudyContext(DataNature.simulated, m, blank_corrected="maybe")
    assert StudyContext(DataNature.simulated, m).blank_corrected == "unknown"


def test_study_context_coerces_strings_to_enums():
    c = StudyContext("simulated", (MethodSpec("PyGC", "py_gc_ms"), MethodSpec("R", "µRaman")))
    assert c.data_nature is DataNature.simulated
    assert [s.technique for s in c.methods] == [Technique.py_gc_ms, Technique.micro_raman]


@pytest.mark.parametrize("make", [
    lambda: StudyContext("garbage", (MethodSpec("PyGC", Technique.py_gc_ms),)),
    lambda: MethodSpec("PyGC", "nonsense"),
    lambda: MethodSpec("PyGC", 3),
])
def test_unknown_enum_values_rejected(make):
    with pytest.raises(ValueError, match="inconnu"):
        make()


def test_detection_limit_valid_values_and_unit_code():
    dl = DetectionLimit("PyGC", "PE", 0.1, 0.3, "µg/mL", "simulated")
    assert (dl.lod, dl.loq, dl.unit_code) == (0.1, 0.3, "ug/mL")
    dl = DetectionLimit("PyGC", "PE", None, 2, "ng/mL", "simulated")
    assert (dl.lod, dl.loq, dl.unit_code) == (None, 2.0, "ng/mL")


@pytest.mark.parametrize("bad", [-0.1, float("nan"), float("inf"), "0.1", True])
@pytest.mark.parametrize("name", ["lod", "loq"])
def test_detection_limit_rejects_bad_limits(name, bad):
    kw = {"lod": 0.1, "loq": 0.3, name: bad}
    with pytest.raises(ValueError, match=name.upper()):
        DetectionLimit("PyGC", "PE", kw["lod"], kw["loq"], "ug/mL", "simulated")


@pytest.mark.parametrize("unit", ["furlongs", "", "ppm"])
def test_detection_limit_rejects_unknown_unit(unit):
    with pytest.raises(ValueError, match="nité"):
        DetectionLimit("PyGC", "PE", 0.1, 0.3, unit, "simulated")
