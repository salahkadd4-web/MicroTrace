"""Conversions between B1 dataclasses and their Pydantic mirrors.

B1 ``ValueError`` (French messages) are never caught here: routes map them to 422.
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import fields

from microtrace_core.results.units import parse_unit
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

from microtrace_core.results.quality import (
    BlankSummary,
    QualityRecord,
    QualityResult,
    RecordRef,
)

from microtrace_engine import quality_text
from microtrace_engine.schemas import (
    CountsModel,
    DetectionLimitModel,
    FrequencyModel,
    ImportResultModel,
    IssueModel,
    MappingModel,
    MeasurementRecordModel,
    MethodSpecModel,
    PolymerStatsModel,
    QcSummaryModel,
    QualityFigureModel,
    QualityGroupModel,
    QualityNoteModel,
    QualityRecordModel,
    QualityRecordRefModel,
    QualityResponse,
    QualityRuleModel,
    QualitySignalModel,
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
    return _record_from_data(m.model_dump())


def _record_from_data(data: dict) -> MeasurementRecord:
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


def counts_of(issues: Iterable[Issue]) -> CountsModel:
    n = {"error": 0, "warning": 0, "info": 0}
    for i in issues:
        n[i.severity] += 1
    return CountsModel(**n)


def import_result_to_model(
    r: ImportResult, *, engine_version: str, sha256: str, sheet: str | None,
) -> ImportResultModel:
    counts = counts_of(r.issues)
    return ImportResultModel(
        records=[record_to_model(x) for x in r.records],
        qc_records=[record_to_model(x) for x in r.qc_records],
        issues=[issue_to_model(i) for i in r.issues],
        n_rows=r.n_rows, rules_version=r.rules_version,
        has_errors=r.has_errors, counts=counts,
        engine_version=engine_version, sha256=sha256, sheet=sheet)


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


_IDENTITY_FIELDS = {"import_id", "file_sha256", "sheet"}


def quality_record_from_model(m: QualityRecordModel) -> QualityRecord:
    record = _record_from_data(m.model_dump(exclude=_IDENTITY_FIELDS))
    return QualityRecord(
        RecordRef(m.import_id, m.file_sha256, m.sheet, record.source_row, record.source_column),
        record)


def blank_from_model(m: QcSummaryModel) -> BlankSummary:
    return BlankSummary(m.id, m.polymer, m.kind, m.n, m.mean, m.sd, m.unit_code, m.source)


def _group_model(g) -> QualityGroupModel:
    return QualityGroupModel(
        polymer=g.polymer, method=g.method, matrix=g.matrix.value, matrix_detail=g.matrix_detail,
        kind=g.kind.value, basis=g.basis.value, canonical_unit=g.canonical_unit.code)


_CANONICAL_FIGURES = frozenset({"value", "blank_mean", "min", "max", "mean", "median", "mad"})


def quality_result_to_model(result: QualityResult, blank_corrected: str) -> QualityResponse:
    """The exact numbers of core (never recomputed) with the French texts of quality_text."""
    signals = []
    for s in result.signals:
        figures = []
        for name, value in s.figures:
            unit = None
            if name in _CANONICAL_FIGURES:
                unit = s.group.canonical_unit.code
            elif name == "blank_mean_reported" and s.blank is not None:
                parsed = parse_unit(s.blank.unit_code)
                unit = parsed.code if parsed else None
            figures.append(QualityFigureModel(
                name=name, label=quality_text.figure_label(name), value=value, unit=unit))
        refs = []
        for x in s.records:
            r = x.record
            quantified = r.status == DetectionStatus.quantified
            refs.append(QualityRecordRefModel(
                import_id=x.ref.import_id, file_sha256=x.ref.file_sha256, sheet=x.ref.sheet,
                source_row=x.ref.source_row, source_column=x.ref.source_column,
                sample_id=r.sample_id, aliquot=r.aliquot, status=r.status.value,
                canonical_value=r.canonical_value if quantified else None,
                canonical_unit=r.canonical_unit.code))
        signals.append(QualitySignalModel(
            key=s.key, rule=s.rule.value, category=quality_text.CATEGORY[s.rule],
            title=quality_text.RULE_TEXTS[s.rule].title,
            subject_label=quality_text.subject_label(s),
            explanation=quality_text.explanation(s, blank_corrected),
            group=_group_model(s.group), sample_id=s.sample_id, aliquot=s.aliquot,
            blank_id=s.blank.id if s.blank else None, dimension=s.dimension,
            stratum=s.stratum, figures=figures, records=refs))
    notes = [QualityNoteModel(
        rule=n.rule.value, reason=n.reason.value,
        group=_group_model(n.group) if n.group else None,
        message=quality_text.note_message(n)) for n in result.notes]
    rules = [QualityRuleModel(rule=rule.value, title=t.title, description=t.description,
                              limits=list(t.limits))
             for rule, t in quality_text.RULE_TEXTS.items()]
    return QualityResponse(quality_rules_version=result.version, signals=signals, notes=notes,
                           rules=rules)
