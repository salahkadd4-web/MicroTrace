"""Honest per-sample aggregation, quantification frequencies and statistics.

Never pooled: aggregation, frequencies and statistics are always split by matrix
(plasma and whole blood are never combined; "other" matrices stay apart by their
detail), and statistics also by method, quantity kind and basis.
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
_Key = tuple[str, Matrix, str]  # (polymer, matrix, matrix detail)


@dataclass(frozen=True)
class SampleResult:
    sample_id: str
    matrix: Matrix
    matrix_detail: str
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
    matrix_detail: str
    n_samples: int
    n_quantified: int
    fraction: float


@dataclass(frozen=True)
class PolymerStats:
    """Statistics of the per-sample results of one (polymer, method, matrix, kind, basis)."""

    polymer: str
    method: str
    matrix: Matrix
    matrix_detail: str
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


def _detail(r: MeasurementRecord) -> str:
    """The matrix detail that tells "other" matrices apart ("" for the named matrices)."""
    return r.matrix_detail.strip() if r.matrix is Matrix.other else ""


def _is_quantified(r: MeasurementRecord) -> bool:
    return r.status == DetectionStatus.quantified and r.canonical_value is not None


def aggregate_aliquots(records: Iterable[MeasurementRecord]) -> list[SampleResult]:
    """One result per (sample, matrix, polymer, method, kind, basis); never pooled across."""
    groups: dict[tuple[str, ...], list[MeasurementRecord]] = defaultdict(list)
    for r in _samples(records):
        groups[(r.sample_id, r.matrix.value, _detail(r), r.polymer, r.method, r.kind.value,
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
            sample_id=first.sample_id, matrix=first.matrix, matrix_detail=_detail(first),
            polymer=first.polymer,
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
    analysed: dict[_Key, set[str]] = defaultdict(set)
    quantified: dict[_Key, set[str]] = defaultdict(set)
    keys: set[_Key] = set()
    for r in rows:
        d = _detail(r)
        keys.add((r.polymer, r.matrix, d))
        if r.status != DetectionStatus.not_analysed:
            analysed[(r.polymer, r.matrix, d)].add(r.sample_id)
            analysed[(ANY, r.matrix, d)].add(r.sample_id)
        if _is_quantified(r):
            quantified[(r.polymer, r.matrix, d)].add(r.sample_id)
            quantified[(ANY, r.matrix, d)].add(r.sample_id)

    def freq(key: _Key) -> Frequency:
        k, n = len(quantified[key]), len(analysed[key])
        return Frequency(key[0], key[1], key[2], n, k, k / n if n else 0.0)

    def order(key: _Key) -> tuple[str, str, str]:
        return key[0], key[1].value, key[2]

    out = [freq(key) for key in sorted(keys, key=order)]
    out.extend(freq((ANY, m, d)) for m, d in sorted({(m, d) for _, m, d in keys},
                                                     key=lambda md: (md[0].value, md[1])))
    return out


def describe(records: Iterable[MeasurementRecord]) -> list[PolymerStats]:
    """Statistics per (polymer, method, matrix, kind, basis) of the per-sample results;
    ``max_measurement`` is the largest single quantified aliquot. Never pooled across."""
    rows = _samples(records)
    groups: dict[tuple[str, ...], list[SampleResult]] = defaultdict(list)
    for s in aggregate_aliquots(rows):
        groups[(s.polymer, s.method, s.matrix.value, s.matrix_detail, s.kind.value,
                s.basis.value)].append(s)
    measurements: dict[tuple[str, ...], list[float]] = defaultdict(list)
    for r in rows:
        if _is_quantified(r) and r.canonical_value is not None:
            measurements[(r.polymer, r.method, r.matrix.value, _detail(r), r.kind.value,
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
            polymer=key[0], method=key[1], matrix=items[0].matrix,
            matrix_detail=items[0].matrix_detail, kind=items[0].kind,
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
