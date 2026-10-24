"""Frozen records and study context for laboratory result tables."""
from __future__ import annotations

from dataclasses import dataclass

from microtrace_core.results.units import Unit
from microtrace_core.results.vocab import (
    Basis,
    DataNature,
    DetectionStatus,
    IdentificationStatus,
    Matrix,
    QuantityKind,
    RecordType,
    Technique,
)

_BLANK_CORRECTED = frozenset({"yes", "no", "unknown"})


@dataclass(frozen=True)
class DetectionLimit:
    method: str
    polymer: str
    lod: float | None
    loq: float | None
    unit_code: str
    source: str


@dataclass(frozen=True)
class MethodSpec:
    name: str
    technique: Technique


@dataclass(frozen=True)
class StudyContext:
    data_nature: DataNature
    methods: tuple[MethodSpec, ...]
    limits: tuple[DetectionLimit, ...] = ()
    reference_doi: str | None = None
    reference_license: str | None = None
    blank_corrected: str = "unknown"

    def __post_init__(self) -> None:
        if self.blank_corrected not in _BLANK_CORRECTED:
            raise ValueError(
                "blank_corrected doit valoir yes, no ou unknown "
                f"(reçu : {self.blank_corrected!r})"
            )


@dataclass(frozen=True)
class MeasurementRecord:
    sample_id: str
    aliquot: str
    record_type: RecordType
    matrix: Matrix
    matrix_detail: str
    polymer: str
    polymer_raw: str
    method: str
    technique: Technique
    reported_value: str
    value: float | None
    unit: Unit
    canonical_value: float | None
    canonical_unit: Unit
    status: DetectionStatus
    lod: float | None
    loq: float | None
    identification_status: IdentificationStatus
    size_min_um: float | None
    size_max_um: float | None
    analysis_date: str
    batch: str
    lab: str
    comment: str
    source_row: int
    source_column: str

    @property
    def kind(self) -> QuantityKind:
        return self.unit.kind

    @property
    def basis(self) -> Basis:
        return self.unit.basis
