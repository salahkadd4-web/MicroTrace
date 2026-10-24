"""Honest per-sample aggregation, quantification frequencies and statistics."""
from __future__ import annotations

import statistics
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from microtrace_core.results.records import MeasurementRecord
from microtrace_core.results.units import Unit
from microtrace_core.results.vocab import (
    STATUS_RANK,
    Basis,
    DetectionStatus,
    QuantityKind,
    RecordType,
)

AGGREGATION_RULE_FR = (
    "Valeur par échantillon = moyenne des aliquotes quantifiées (≥ LOQ) ; si aucune "
    "aliquote n'est quantifiée, statut le plus élevé observé, sans valeur. "
    "Aucune imputation."
)
ANY = "ANY"


@dataclass(frozen=True)
class SampleResult:
    sample_id: str
    polymer: str
    method: str
    kind: QuantityKind
    basis: Basis
    canonical_unit: Unit
    status: DetectionStatus
    value: float | None
    n_aliquots: int
    n_quantified: int


@dataclass(frozen=True)
class Frequency:
    polymer: str
    n_samples: int
    n_quantified: int
    fraction: float


@dataclass(frozen=True)
class PolymerStats:
    polymer: str
    kind: QuantityKind
    basis: Basis
    canonical_unit: Unit
    counts_by_status: dict[str, int]
    n_quantified: int
    min: float | None
    median: float | None
    mean: float | None
    max: float | None
    max_measurement: float | None


def _samples(records: Iterable[MeasurementRecord]) -> list[MeasurementRecord]:
    return [r for r in records if r.record_type == RecordType.sample]


def _is_quantified(r: MeasurementRecord) -> bool:
    return r.status == DetectionStatus.quantified and r.canonical_value is not None


def aggregate_aliquots(records: Iterable[MeasurementRecord]) -> list[SampleResult]:
    groups: dict[tuple[str, str, str, str, str], list[MeasurementRecord]] = defaultdict(list)
    for r in _samples(records):
        groups[(r.sample_id, r.polymer, r.method, r.kind.value, r.basis.value)].append(r)
    out: list[SampleResult] = []
    for key in sorted(groups):
        rows = groups[key]
        quantified = [r.canonical_value for r in rows
                      if _is_quantified(r) and r.canonical_value is not None]
        if quantified:
            status = DetectionStatus.quantified
            value: float | None = statistics.mean(quantified)
        else:
            status = max((r.status for r in rows), key=lambda s: STATUS_RANK[s])
            value = None
        first = rows[0]
        out.append(SampleResult(
            sample_id=first.sample_id, polymer=first.polymer, method=first.method,
            kind=first.kind, basis=first.basis, canonical_unit=first.canonical_unit,
            status=status, value=value, n_aliquots=len(rows), n_quantified=len(quantified),
        ))
    return out


def quantification_frequency(records: Iterable[MeasurementRecord]) -> list[Frequency]:
    rows = _samples(records)
    n = len({r.sample_id for r in rows})
    by_polymer: dict[str, set[str]] = defaultdict(set)
    any_quantified: set[str] = set()
    polymers: set[str] = set()
    for r in rows:
        polymers.add(r.polymer)
        if _is_quantified(r):
            by_polymer[r.polymer].add(r.sample_id)
            any_quantified.add(r.sample_id)

    def freq(polymer: str, k: int) -> Frequency:
        return Frequency(polymer, n, k, k / n if n else 0.0)

    out = [freq(p, len(by_polymer[p])) for p in sorted(polymers)]
    out.append(freq(ANY, len(any_quantified)))
    return out


def describe(records: Iterable[MeasurementRecord]) -> list[PolymerStats]:
    rows = _samples(records)
    groups: dict[tuple[str, str, str], list[SampleResult]] = defaultdict(list)
    for s in aggregate_aliquots(rows):
        groups[(s.polymer, s.kind.value, s.basis.value)].append(s)
    measurements: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    for r in rows:
        if _is_quantified(r) and r.canonical_value is not None:
            measurements[(r.polymer, r.kind.value, r.basis.value)].append(r.canonical_value)
    out: list[PolymerStats] = []
    for key in sorted(groups):
        items = groups[key]
        counts = {st.value: 0 for st in DetectionStatus}
        for s in items:
            counts[s.status.value] += 1
        values = [s.value for s in items if s.value is not None]
        meas = measurements.get(key, [])
        out.append(PolymerStats(
            polymer=key[0], kind=items[0].kind, basis=items[0].basis,
            canonical_unit=items[0].canonical_unit, counts_by_status=counts,
            n_quantified=len(values),
            min=min(values) if values else None,
            median=statistics.median(values) if values else None,
            mean=statistics.mean(values) if values else None,
            max=max(values) if values else None,
            max_measurement=max(meas) if meas else None,
        ))
    return out
