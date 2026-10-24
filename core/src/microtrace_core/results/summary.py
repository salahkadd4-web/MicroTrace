"""Honest per-sample aggregation, quantification frequencies and statistics.

Never pooled: aggregation, frequencies and statistics are always split by matrix
(plasma and whole blood are never combined), and statistics also by method,
quantity kind and basis.
"""
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
    Matrix,
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
    matrix: Matrix
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
    """Quantification frequency of one polymer ("ANY": any polymer) in one matrix."""

    polymer: str
    matrix: Matrix
    n_samples: int
    n_quantified: int
    fraction: float


@dataclass(frozen=True)
class PolymerStats:
    """Statistics of the per-sample results of one (polymer, method, matrix, kind, basis)."""

    polymer: str
    method: str
    matrix: Matrix
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
    """One result per (sample, matrix, polymer, method, kind, basis); never pooled across."""
    groups: dict[tuple[str, str, str, str, str, str], list[MeasurementRecord]] = defaultdict(list)
    for r in _samples(records):
        groups[(r.sample_id, r.matrix.value, r.polymer, r.method, r.kind.value,
                r.basis.value)].append(r)
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
            sample_id=first.sample_id, matrix=first.matrix, polymer=first.polymer,
            method=first.method,
            kind=first.kind, basis=first.basis, canonical_unit=first.canonical_unit,
            status=status, value=value, n_aliquots=len(rows), n_quantified=len(quantified),
        ))
    return out


def quantification_frequency(records: Iterable[MeasurementRecord]) -> list[Frequency]:
    """Quantification frequency per (polymer, matrix), across methods and units.

    Matrices are never pooled: one row per (polymer, matrix) present among the
    sample records, then one "ANY" row per matrix. A sample counts as quantified
    for a polymer if any aliquot, under any method or unit, is quantified. The
    denominator for (polymer, matrix) is the number of samples of that matrix with
    at least one record of that polymer whose status is not ``not_analysed``; for
    ("ANY", matrix), the samples of that matrix with at least one analysed record.
    Samples where a polymer was not measured are never counted against it. Rows
    are ordered by (polymer, matrix), the "ANY" rows last; no sample, no row.
    """
    rows = _samples(records)
    analysed: dict[tuple[str, Matrix], set[str]] = defaultdict(set)
    quantified: dict[tuple[str, Matrix], set[str]] = defaultdict(set)
    keys: set[tuple[str, Matrix]] = set()
    for r in rows:
        keys.add((r.polymer, r.matrix))
        if r.status != DetectionStatus.not_analysed:
            analysed[(r.polymer, r.matrix)].add(r.sample_id)
            analysed[(ANY, r.matrix)].add(r.sample_id)
        if _is_quantified(r):
            quantified[(r.polymer, r.matrix)].add(r.sample_id)
            quantified[(ANY, r.matrix)].add(r.sample_id)

    def freq(key: tuple[str, Matrix]) -> Frequency:
        k, n = len(quantified[key]), len(analysed[key])
        return Frequency(key[0], key[1], n, k, k / n if n else 0.0)

    def order(key: tuple[str, Matrix]) -> tuple[str, str]:
        return key[0], key[1].value

    out = [freq(key) for key in sorted(keys, key=order)]
    out.extend(freq((ANY, m)) for m in sorted({m for _, m in keys}, key=lambda m: m.value))
    return out


def describe(records: Iterable[MeasurementRecord]) -> list[PolymerStats]:
    """Statistics per (polymer, method, matrix, kind, basis) of the per-sample results;
    ``max_measurement`` is the largest single quantified aliquot. Never pooled across."""
    rows = _samples(records)
    groups: dict[tuple[str, str, str, str, str], list[SampleResult]] = defaultdict(list)
    for s in aggregate_aliquots(rows):
        groups[(s.polymer, s.method, s.matrix.value, s.kind.value, s.basis.value)].append(s)
    measurements: dict[tuple[str, str, str, str, str], list[float]] = defaultdict(list)
    for r in rows:
        if _is_quantified(r) and r.canonical_value is not None:
            measurements[(r.polymer, r.method, r.matrix.value, r.kind.value,
                          r.basis.value)].append(r.canonical_value)
    out: list[PolymerStats] = []
    for key in sorted(groups):
        items = groups[key]
        counts = {st.value: 0 for st in DetectionStatus}
        for s in items:
            counts[s.status.value] += 1
        values = [s.value for s in items if s.value is not None]
        meas = measurements.get(key, [])
        out.append(PolymerStats(
            polymer=key[0], method=key[1], matrix=items[0].matrix, kind=items[0].kind,
            basis=items[0].basis,
            canonical_unit=items[0].canonical_unit, counts_by_status=counts,
            n_quantified=len(values),
            min=min(values) if values else None,
            median=statistics.median(values) if values else None,
            mean=statistics.mean(values) if values else None,
            max=max(values) if values else None,
            max_measurement=max(meas) if meas else None,
        ))
    return out
