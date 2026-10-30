"""Pydantic v2 mirrors of the ``microtrace_core.results`` dataclasses.

Enumerations are ``Literal`` types derived from the B1 enums (never copied by hand);
``Unit`` is serialised as its code. These models feed the OpenAPI schema.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from microtrace_core.results import (
    ISSUE_CODES,
    UNITS,
    Basis,
    DataNature,
    DetectionStatus,
    IdentificationStatus,
    Matrix,
    QuantityKind,
    RecordType,
    Technique,
)
from microtrace_core.results.issues import Severity
from microtrace_core.results.quality import NoteReason, QualityRule
from microtrace_core.polymers import OTHER
from pydantic import BaseModel, ConfigDict, Field, model_validator

MatrixName = Literal[tuple(m.value for m in Matrix)]  # type: ignore[valid-type]
TechniqueName = Literal[tuple(m.value for m in Technique)]  # type: ignore[valid-type]
QuantityKindName = Literal[tuple(m.value for m in QuantityKind)]  # type: ignore[valid-type]
BasisName = Literal[tuple(m.value for m in Basis)]  # type: ignore[valid-type]
DetectionStatusName = Literal[tuple(m.value for m in DetectionStatus)]  # type: ignore[valid-type]
RecordTypeName = Literal[tuple(m.value for m in RecordType)]  # type: ignore[valid-type]
IdentificationStatusName = Literal[  # type: ignore[valid-type]
    tuple(m.value for m in IdentificationStatus)]
DataNatureName = Literal[tuple(m.value for m in DataNature)]  # type: ignore[valid-type]
QualityRuleName = Literal[tuple(m.value for m in QualityRule)]  # type: ignore[valid-type]
NoteReasonName = Literal[tuple(m.value for m in NoteReason)]  # type: ignore[valid-type]
UnitCode = Literal[tuple(UNITS)]  # type: ignore[valid-type]
IssueCode = Literal[tuple(ISSUE_CODES)]  # type: ignore[valid-type]

Number = Annotated[float, Field(allow_inf_nan=False)]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ErrorLoc(_Model):
    """Location and type of one validation error (never the submitted value)."""

    loc: list[str | int] = Field(
        description='Path in the request; a segment that may be user data is "*"')
    type: str


class ErrorModel(_Model):
    """Body of every error response: a French message, and locations for a 422."""

    detail: str
    errors: list[ErrorLoc] | None = None


class HealthResponse(_Model):
    engine_api: int
    engine_version: str
    rules_version: str


class ValidateResponse(_Model):
    ok: bool


class IssueModel(_Model):
    code: IssueCode
    severity: Severity
    message: str
    row: int | None = None
    column: str | None = None
    field: str | None = None


class MeasurementRecordModel(_Model):
    sample_id: str
    aliquot: str
    record_type: RecordTypeName
    matrix: MatrixName
    matrix_detail: str
    polymer: str
    polymer_raw: str
    method: str
    technique: TechniqueName
    reported_value: str
    value: Number | None
    unit: UnitCode
    canonical_value: Number | None
    canonical_unit: UnitCode
    status: DetectionStatusName
    lod: Number | None
    loq: Number | None
    canonical_lod: Number | None
    canonical_loq: Number | None
    identification_status: IdentificationStatusName
    size_min_um: Number | None
    size_max_um: Number | None
    analysis_date: str
    batch: str
    lab: str
    comment: str
    source_row: int
    source_column: str


class MappingModel(_Model):
    mode: Literal["long", "wide"]
    field_columns: dict[str, str]
    polymer_columns: dict[str, str] = Field(default_factory=dict)
    constants: dict[str, str] = Field(default_factory=dict)
    split_aliquot_suffix: bool = False


class MethodSpecModel(_Model):
    name: str
    technique: TechniqueName


class DetectionLimitModel(_Model):
    method: str
    polymer: str
    lod: Number | None
    loq: Number | None
    unit_code: str
    source: str


class StudyContextModel(_Model):
    data_nature: DataNatureName
    methods: list[MethodSpecModel]
    limits: list[DetectionLimitModel] = Field(default_factory=list)
    reference_doi: str | None = None
    reference_license: str | None = None
    blank_corrected: Literal["yes", "no", "unknown"] = "unknown"


class CountsModel(_Model):
    error: int
    warning: int
    info: int


class ImportResultModel(_Model):
    records: list[MeasurementRecordModel]
    qc_records: list[MeasurementRecordModel]
    issues: list[IssueModel]
    n_rows: int
    rules_version: str
    has_errors: bool
    counts: CountsModel
    engine_version: str
    sha256: str = Field(description="SHA-256 (hex) of the file bytes checked")
    sheet: str | None = Field(description="Sheet read (XLSX), None for a CSV")


class SampleResultModel(_Model):
    sample_id: str
    matrix: MatrixName
    matrix_detail: str
    polymer: str
    method: str
    kind: QuantityKindName
    basis: BasisName
    canonical_unit: UnitCode
    status: DetectionStatusName
    value: Number | None
    n_aliquots: int
    n_quantified: int


class FrequencyModel(_Model):
    polymer: str
    matrix: MatrixName
    matrix_detail: str
    n_samples: int
    n_quantified: int
    fraction: Number


class PolymerStatsModel(_Model):
    polymer: str
    method: str
    matrix: MatrixName
    matrix_detail: str
    kind: QuantityKindName
    basis: BasisName
    canonical_unit: UnitCode
    counts_by_status: dict[str, int]
    n_quantified: int
    min: Number | None
    median: Number | None
    mean: Number | None
    max: Number | None
    max_measurement: Number | None


class ExistingKeyModel(_Model):
    """Key of a measurement already recorded in an active import of the study."""

    sample_id: str
    aliquot: str = ""
    record_type: RecordTypeName
    polymer: str
    polymer_raw: str = ""
    method: str
    matrix: MatrixName
    matrix_detail: str = ""

    @model_validator(mode="after")
    def _other_needs_raw(self) -> ExistingKeyModel:
        if self.polymer == OTHER and not self.polymer_raw.strip():
            raise ValueError("polymer_raw requis pour un polymère « OTHER »")
        return self


class TableReadResponse(_Model):
    filename: str
    sha256: str
    size: int
    sheet: str | None
    sheets: list[str]
    columns: list[str]
    preview: list[dict[str, str]]
    n_rows: int


class SummaryRequest(_Model):
    records: list[MeasurementRecordModel]


class SummaryResponse(_Model):
    frequencies: list[FrequencyModel]
    stats: list[PolymerStatsModel]
    samples: list[SampleResultModel]
    aggregation_rule: str


class ReportStudyModel(_Model):
    """Nature, DOI, licence and blank correction come from the report ``context``."""

    title: str = Field(min_length=1, max_length=300)


class ReportFileModel(_Model):
    name: str
    sha256: str
    size: int
    sheet: str | None = None


class ReportImportModel(_Model):
    file: ReportFileModel
    rules_version: str
    date: datetime = Field(description="ISO 8601; naive values are taken as UTC")
    author: str
    issues: list[IssueModel] = Field(default_factory=list)  # the report counts them itself


class ReportRequest(_Model):
    study: ReportStudyModel
    imports: list[ReportImportModel]
    records: list[MeasurementRecordModel]
    qc_records: list[MeasurementRecordModel] = Field(default_factory=list)
    context: StudyContextModel
    generated_at: datetime | None = Field(
        default=None, description="ISO 8601; naive values are taken as UTC")
    context_changed: bool = Field(
        default=False,
        description="True when the study parameters changed since some imports; "
                    "the report then states it at the top")


class ReportResponse(_Model):
    markdown: str
    html: str


class DictionaryResponse(_Model):
    csv: str
    markdown: str


class ExampleResponse(_Model):
    filename: str
    csv_base64: str
    context: StudyContextModel
    mapping: MappingModel


class QualityRecordModel(MeasurementRecordModel):
    """A measurement with the identity of its cell: import, file fingerprint, sheet."""

    import_id: str = Field(min_length=1)
    file_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    sheet: str = ""


class QcSummaryModel(_Model):
    """A summarised quality control; ``unit_code`` and ``kind`` are free text (an old row
    with an unknown unit gives a note, not a 422 for the whole study)."""

    id: str = Field(min_length=1)
    polymer: str
    kind: str
    n: int = Field(ge=1)
    mean: Number | None = None
    sd: Number | None = None
    unit_code: str
    source: str


class QualityRequest(_Model):
    records: list[QualityRecordModel]
    qc_summaries: list[QcSummaryModel] = Field(default_factory=list)
    blank_corrected: Literal["yes", "no", "unknown"] = "unknown"


class QualityGroupModel(_Model):
    polymer: str
    method: str
    matrix: MatrixName
    matrix_detail: str
    kind: QuantityKindName
    basis: BasisName
    canonical_unit: UnitCode


class QualityFigureModel(_Model):
    name: str
    label: str
    value: Number
    unit: UnitCode | None = None


class QualityRecordRefModel(_Model):
    import_id: str
    file_sha256: str
    sheet: str
    source_row: int
    source_column: str
    sample_id: str
    aliquot: str
    status: DetectionStatusName
    canonical_value: Number | None = Field(description="Null unless the status is quantified")
    canonical_unit: UnitCode


class QualitySignalModel(_Model):
    key: str = Field(pattern=r"^[0-9a-f]{64}$")
    rule: QualityRuleName
    category: Literal["replicates", "blanks", "distribution", "batches"]
    title: str
    subject_label: str
    explanation: str
    group: QualityGroupModel
    sample_id: str | None = None
    aliquot: str | None = None
    blank_id: str | None = None
    dimension: Literal["batch", "analysis_date"] | None = None
    stratum: str | None = None
    figures: list[QualityFigureModel]
    records: list[QualityRecordRefModel]


class QualityNoteModel(_Model):
    rule: QualityRuleName
    reason: NoteReasonName
    group: QualityGroupModel | None = None
    message: str


class QualityRuleModel(_Model):
    rule: QualityRuleName
    title: str
    description: str
    limits: list[str]


class QualityResponse(_Model):
    quality_rules_version: str
    signals: list[QualitySignalModel]
    notes: list[QualityNoteModel]
    rules: list[QualityRuleModel]
