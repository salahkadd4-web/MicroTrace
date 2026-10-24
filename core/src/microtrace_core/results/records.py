"""Frozen records and study context for laboratory result tables."""
from __future__ import annotations

import math
from dataclasses import dataclass

from microtrace_core.results.units import Unit, parse_unit
from microtrace_core.results.vocab import (
    Basis,
    DataNature,
    DetectionStatus,
    IdentificationStatus,
    Matrix,
    QuantityKind,
    RecordType,
    Technique,
    parse_technique,
)

_BLANK_CORRECTED = frozenset({"yes", "no", "unknown"})


def _limit(name: str, value: object) -> float | None:
    """None, or a finite non-negative number (as float); ValueError otherwise."""
    if value is None:
        return None
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or value < 0):
        raise ValueError(
            f"{name.upper()} de l'étude invalide : nombre fini et positif ou nul attendu "
            f"(reçu : {value!r})")
    return float(value)


@dataclass(frozen=True)
class DetectionLimit:
    """Study detection limits for one (method, polymer); ``unit_code`` is normalised
    to a UNITS code ("µg/mL" -> "ug/mL")."""

    method: str
    polymer: str
    lod: float | None
    loq: float | None
    unit_code: str
    source: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "lod", _limit("lod", self.lod))
        object.__setattr__(self, "loq", _limit("loq", self.loq))
        unit = parse_unit(self.unit_code) if isinstance(self.unit_code, str) else None
        if unit is None:
            raise ValueError(f"Unité de limite inconnue : {self.unit_code!r}")
        object.__setattr__(self, "unit_code", unit.code)


@dataclass(frozen=True)
class MethodSpec:
    name: str
    technique: Technique

    def __post_init__(self) -> None:
        tech = self.technique
        if not isinstance(tech, Technique):
            tech = None
            if isinstance(self.technique, str):
                tech = (Technique(self.technique) if self.technique in Technique.__members__
                        else parse_technique(self.technique))
            if tech is None:
                raise ValueError(f"Technique inconnue : {self.technique!r}")
            object.__setattr__(self, "technique", tech)


@dataclass(frozen=True)
class StudyContext:
    data_nature: DataNature
    methods: tuple[MethodSpec, ...]
    limits: tuple[DetectionLimit, ...] = ()
    reference_doi: str | None = None
    reference_license: str | None = None
    blank_corrected: str = "unknown"

    def __post_init__(self) -> None:
        if not isinstance(self.data_nature, DataNature):
            if self.data_nature not in DataNature.__members__:
                raise ValueError(f"Nature des données inconnue : {self.data_nature!r}")
            object.__setattr__(self, "data_nature", DataNature(self.data_nature))
        object.__setattr__(self, "methods", tuple(self.methods))
        object.__setattr__(self, "limits", tuple(self.limits))
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
