"""Conversions between B1 dataclasses and their Pydantic mirrors.

B1 ``ValueError`` (French messages) are never caught here: routes map them to 422.
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import fields

from microtrace_core.results import (
    UNITS,
    DetectionLimit,
    DetectionStatus,
    Frequency,
    IdentificationStatus,
    ImportResult,
    Issue,
    Mapping,
    Matrix,
    MeasurementRecord,
    MethodSpec,
    PolymerStats,
    RecordType,
    SampleResult,
    StudyContext,
    Technique,
)

from microtrace_engine.schemas import (
    DetectionLimitModel,
    FrequencyModel,
    ImportResultModel,
    IssueModel,
    MappingModel,
    MeasurementRecordModel,
    MethodSpecModel,
    PolymerStatsModel,
    SampleResultModel,
    StudyContextModel,
)

_UNIT_FIELDS = ("unit", "canonical_unit")


def _unit(code: str):
    try:
        return UNITS[code]
    except KeyError:
        raise ValueError(f"Unité inconnue : {code!r}") from None


def issue_to_model(i: Issue) -> IssueModel:
    return IssueModel(code=i.code, severity=i.severity, message=i.message, row=i.row,
                      column=i.column, field=i.field)


def record_to_model(r: MeasurementRecord) -> MeasurementRecordModel:
    data = {f.name: getattr(r, f.name) for f in fields(r)}
    for name in _UNIT_FIELDS:
        data[name] = data[name].code
    for name in ("record_type", "matrix", "technique", "status", "identification_status"):
        data[name] = data[name].value
    return MeasurementRecordModel(**data)


def record_from_model(m: MeasurementRecordModel) -> MeasurementRecord:
    data = m.model_dump()
    for name in _UNIT_FIELDS:
        data[name] = _unit(data[name])
    data["record_type"] = RecordType(data["record_type"])
    data["matrix"] = Matrix(data["matrix"])
    data["technique"] = Technique(data["technique"])
    data["status"] = DetectionStatus(data["status"])
    data["identification_status"] = IdentificationStatus(data["identification_status"])
    return MeasurementRecord(**data)


def mapping_to_model(m: Mapping) -> MappingModel:
    return MappingModel(
        mode=m.mode, field_columns=dict(m.field_columns),
        polymer_columns=dict(m.polymer_columns), constants=dict(m.constants),
        split_aliquot_suffix=m.split_aliquot_suffix)


def mapping_from_model(m: MappingModel) -> Mapping:
    return Mapping(m.mode, dict(m.field_columns), dict(m.polymer_columns),
                   dict(m.constants), m.split_aliquot_suffix)


def context_to_model(c: StudyContext) -> StudyContextModel:
    return StudyContextModel(
        data_nature=c.data_nature.value,
        methods=[MethodSpecModel(name=s.name, technique=s.technique.value) for s in c.methods],
        limits=[DetectionLimitModel(**{f.name: getattr(lim, f.name) for f in fields(lim)})
                for lim in c.limits],
        reference_doi=c.reference_doi, reference_license=c.reference_license,
        blank_corrected=c.blank_corrected)


def context_from_model(m: StudyContextModel) -> StudyContext:
    """Build the B1 StudyContext; its ValueError propagate."""
    return StudyContext(
        data_nature=m.data_nature,  # type: ignore[arg-type]  # B1 coerces and validates
        methods=tuple(MethodSpec(s.name, s.technique) for s in m.methods),  # type: ignore[arg-type]
        limits=tuple(DetectionLimit(**lim.model_dump()) for lim in m.limits),
        reference_doi=m.reference_doi, reference_license=m.reference_license,
        blank_corrected=m.blank_corrected)


def import_result_to_model(r: ImportResult) -> ImportResultModel:
    counts = {"error": 0, "warning": 0, "info": 0}
    for i in r.issues:
        counts[i.severity] += 1
    return ImportResultModel(
        records=[record_to_model(x) for x in r.records],
        qc_records=[record_to_model(x) for x in r.qc_records],
        issues=[issue_to_model(i) for i in r.issues],
        n_rows=r.n_rows, rules_version=r.rules_version,
        has_errors=r.has_errors, counts=counts)


def sample_result_to_model(s: SampleResult) -> SampleResultModel:
    return SampleResultModel(
        sample_id=s.sample_id, matrix=s.matrix.value, matrix_detail=s.matrix_detail,
        polymer=s.polymer, method=s.method, kind=s.kind.value, basis=s.basis.value,
        canonical_unit=s.canonical_unit.code, status=s.status.value, value=s.value,
        n_aliquots=s.n_aliquots, n_quantified=s.n_quantified)


def frequency_to_model(f: Frequency) -> FrequencyModel:
    return FrequencyModel(
        polymer=f.polymer, matrix=f.matrix.value, matrix_detail=f.matrix_detail,
        n_samples=f.n_samples, n_quantified=f.n_quantified, fraction=f.fraction)


def polymer_stats_to_model(p: PolymerStats) -> PolymerStatsModel:
    return PolymerStatsModel(
        polymer=p.polymer, method=p.method, matrix=p.matrix.value,
        matrix_detail=p.matrix_detail, kind=p.kind.value, basis=p.basis.value,
        canonical_unit=p.canonical_unit.code, counts_by_status=dict(p.counts_by_status),
        n_quantified=p.n_quantified, min=p.min, median=p.median, mean=p.mean, max=p.max,
        max_measurement=p.max_measurement)


def summary_to_models(
    samples: Iterable[SampleResult], frequencies: Iterable[Frequency],
    stats: Iterable[PolymerStats],
) -> tuple[list[SampleResultModel], list[FrequencyModel], list[PolymerStatsModel]]:
    return ([sample_result_to_model(s) for s in samples],
            [frequency_to_model(f) for f in frequencies],
            [polymer_stats_to_model(p) for p in stats])
