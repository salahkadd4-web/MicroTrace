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
    DetectionLimit("PyGC", "PE", 0.1, 0.3, "ug/mL", "simulated")
