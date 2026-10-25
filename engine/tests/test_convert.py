from dataclasses import fields

import pytest
from microtrace_core.results import (
    UNITS,
    Basis,
    DataNature,
    DetectionStatus,
    IdentificationStatus,
    Matrix,
    QuantityKind,
    RecordType,
    Technique,
    aggregate_aliquots,
    describe,
    leslie_like_context,
    leslie_like_mapping,
    quantification_frequency,
    run_import,
)
from microtrace_core.results.examples import leslie_like_wide_table
from microtrace_core.results.records import MeasurementRecord
from pydantic import ValidationError
from typing import get_args

from microtrace_engine import convert, schemas


@pytest.fixture(scope="module")
def leslie():
    return run_import(leslie_like_wide_table(), leslie_like_mapping(), leslie_like_context())


def test_record_roundtrip_leslie(leslie):
    assert leslie.records
    for r in leslie.records + leslie.qc_records:
        back = convert.record_from_model(convert.record_to_model(r))
        for f in fields(MeasurementRecord):
            assert getattr(back, f.name) == getattr(r, f.name), f.name
        assert back == r


def test_record_json_roundtrip(leslie):
    for r in leslie.records:
        m = schemas.MeasurementRecordModel.model_validate_json(
            convert.record_to_model(r).model_dump_json())
        assert convert.record_from_model(m) == r


def test_unit_serialised_as_code(leslie):
    data = convert.record_to_model(leslie.records[0]).model_dump(mode="json")
    assert data["unit"] == leslie.records[0].unit.code == "ug/mL"
    assert data["canonical_unit"] in UNITS


def test_extra_fields_refused(leslie):
    data = convert.record_to_model(leslie.records[0]).model_dump()
    with pytest.raises(ValidationError):
        schemas.MeasurementRecordModel(**data, unknown=1)
    with pytest.raises(ValidationError):
        schemas.IssueModel(code="x", severity="error", message="m", extra=1)


def test_nan_refused(leslie):
    data = convert.record_to_model(leslie.records[0]).model_dump()
    data["value"] = float("nan")
    with pytest.raises(ValidationError):
        schemas.MeasurementRecordModel(**data)


def test_enum_values_from_b1():
    def vals(t):
        return set(get_args(t))

    assert vals(schemas.MatrixName) == {m.value for m in Matrix}
    assert vals(schemas.TechniqueName) == {m.value for m in Technique}
    assert vals(schemas.QuantityKindName) == {m.value for m in QuantityKind}
    assert vals(schemas.BasisName) == {m.value for m in Basis}
    assert vals(schemas.DetectionStatusName) == {m.value for m in DetectionStatus}
    assert vals(schemas.RecordTypeName) == {m.value for m in RecordType}
    assert vals(schemas.IdentificationStatusName) == {m.value for m in IdentificationStatus}
    assert vals(schemas.DataNatureName) == {m.value for m in DataNature}
    assert vals(schemas.UnitCode) == set(UNITS)


def test_models_mirror_dataclass_fields():
    from microtrace_core.results import (
        DetectionLimit,
        Frequency,
        ImportResult,
        Issue,
        Mapping,
        MethodSpec,
        PolymerStats,
        SampleResult,
        StudyContext,
    )

    pairs = [
        (schemas.IssueModel, Issue),
        (schemas.MeasurementRecordModel, MeasurementRecord),
        (schemas.MappingModel, Mapping),
        (schemas.MethodSpecModel, MethodSpec),
        (schemas.DetectionLimitModel, DetectionLimit),
        (schemas.StudyContextModel, StudyContext),
        (schemas.ImportResultModel, ImportResult),
        (schemas.SampleResultModel, SampleResult),
        (schemas.FrequencyModel, Frequency),
        (schemas.PolymerStatsModel, PolymerStats),
    ]
    for model, dc in pairs:
        expected = {f.name for f in fields(dc)}
        if dc is ImportResult:  # has_errors (property) and counts are derived fields
            expected |= {"has_errors", "counts"}
        assert set(model.model_fields) == expected, model.__name__


def test_context_roundtrip_and_errors_propagate():
    ctx = leslie_like_context()
    model = convert.context_to_model(ctx)
    assert convert.context_from_model(model) == ctx
    bad = model.model_copy(update={"data_nature": "inconnue"})
    with pytest.raises(ValueError, match="Nature des données inconnue"):
        convert.context_from_model(bad)
    dup = model.model_copy(update={"methods": model.methods * 2})
    with pytest.raises(ValueError, match="deux fois"):
        convert.context_from_model(dup)


def test_mapping_roundtrip():
    m = leslie_like_mapping()
    model = convert.mapping_to_model(m)
    assert convert.mapping_from_model(model) == m
    assert convert.mapping_from_model(
        schemas.MappingModel.model_validate_json(model.model_dump_json())) == m


def test_import_result_model(leslie):
    model = convert.import_result_to_model(leslie)
    assert model.has_errors is leslie.has_errors
    assert model.n_rows == leslie.n_rows
    c = model.counts
    assert c.error + c.warning + c.info == len(leslie.issues)
    assert set(schemas.CountsModel.model_fields) == {"error", "warning", "info"}
    assert len(model.records) == len(leslie.records)
    schemas.ImportResultModel.model_validate_json(model.model_dump_json())


def test_summary_models(leslie):
    samples, freqs, stats = convert.summary_to_models(
        aggregate_aliquots(leslie.records), quantification_frequency(leslie.records),
        describe(leslie.records))
    assert samples and freqs and stats
    for s in stats:
        schemas.PolymerStatsModel.model_validate_json(s.model_dump_json())
    assert all(isinstance(s.counts_by_status, dict) for s in stats)
