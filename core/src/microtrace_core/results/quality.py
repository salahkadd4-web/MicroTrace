"""Quality signals q1: explained flags on laboratory results, never verdicts.

Four documented rules with robust statistics (no machine learning): aliquot discordance,
values near the procedural blanks, robust outliers (modified z-score) and unusual rates
of values below the LOD per batch or analysis date (Fisher's exact test). Only quantified
measurements ever enter a calculation; censored values are never read as numbers, and
groups are never pooled across method, matrix, matrix detail, quantity kind, basis or unit.
See ``docs/models/c7-qualite.md``.
"""
from __future__ import annotations

import hashlib
import json
import statistics
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from scipy.stats import fisher_exact

from microtrace_core.results.records import MeasurementRecord
from microtrace_core.results.summary import (
    aggregate_aliquots,
    is_quantified,
    matrix_detail_key,
)
from microtrace_core.results.units import Unit, UnitMismatchError, convert, parse_unit
from microtrace_core.results.vocab import (
    Basis,
    DetectionStatus,
    Matrix,
    QuantityKind,
    RecordType,
    normalize_result_polymer,
)

QUALITY_RULES_VERSION = "q1"
ALIQUOT_RPD_THRESHOLD = 0.50
NEAR_BLANK_FACTOR = 3.0
MAD_CONSTANT = 0.6745
OUTLIER_Z_THRESHOLD = 3.5
OUTLIER_MIN_SAMPLES = 5
LOD_RATE_ALPHA = 0.01
LOD_RATE_MIN_STRATUM = 5

_PROCEDURAL_BLANK = "procedural_blank"


class QualityRule(StrEnum):
    aliquot_discordance = "aliquot_discordance"
    near_blank = "near_blank"
    robust_outlier = "robust_outlier"
    unusual_lod_rate = "unusual_lod_rate"


class NoteReason(StrEnum):
    no_blank_summary = "no_blank_summary"
    polymers_without_blank = "polymers_without_blank"
    blank_unit_mismatch = "blank_unit_mismatch"
    blank_unit_unknown = "blank_unit_unknown"
    blank_mean_missing = "blank_mean_missing"
    too_few_samples = "too_few_samples"
    zero_mad = "zero_mad"
    dimension_empty = "dimension_empty"
    too_few_in_strata = "too_few_in_strata"
    tests_performed = "tests_performed"


_RULE_ORDER = {rule: i for i, rule in enumerate(QualityRule)}
_REASON_ORDER = {reason: i for i, reason in enumerate(NoteReason)}


@dataclass(frozen=True)
class RecordRef:
    import_id: str
    file_sha256: str
    sheet: str
    source_row: int
    source_column: str


@dataclass(frozen=True)
class QualityRecord:
    ref: RecordRef
    record: MeasurementRecord


@dataclass(frozen=True)
class BlankSummary:
    id: str
    polymer: str
    kind: str
    n: int
    mean: float | None
    sd: float | None
    unit_code: str
    source: str


@dataclass(frozen=True)
class QualityGroup:
    polymer: str
    method: str
    matrix: Matrix
    matrix_detail: str
    kind: QuantityKind
    basis: Basis
    canonical_unit: Unit


@dataclass(frozen=True)
class Signal:
    key: str
    rule: QualityRule
    group: QualityGroup
    sample_id: str | None
    aliquot: str | None
    blank: BlankSummary | None
    dimension: Literal["batch", "analysis_date"] | None
    stratum: str | None
    figures: tuple[tuple[str, float], ...]
    records: tuple[QualityRecord, ...]


@dataclass(frozen=True)
class QualityNote:
    rule: QualityRule
    reason: NoteReason
    group: QualityGroup | None
    blank: BlankSummary | None = None
    dimension: str | None = None
    count: int | None = None
    polymers: tuple[str, ...] = ()


@dataclass(frozen=True)
class QualityResult:
    version: str
    signals: tuple[Signal, ...]
    notes: tuple[QualityNote, ...]


# --------------------------------------------------------------------------- statistics

def clean(x: float) -> float:
    """Round to 12 significant digits: every compared quantity is computed once, cleaned of
    binary floating-point noise, compared strictly and exposed as that same number."""
    return float(f"{x:.12g}")


def relative_range(values: Sequence[float]) -> float:
    """(max - min) / mean, cleaned (12 significant digits); for two values, the relative
    percent difference as a fraction. Needs at least one value (ValueError otherwise); a
    zero mean gives 0.0, since no relative spread can be defined."""
    if not values:
        raise ValueError("relative_range needs at least one value")
    vals = [clean(v) for v in values]
    mean = clean(statistics.fmean(vals))
    return clean((max(vals) - min(vals)) / mean) if mean else 0.0


def modified_z_scores(values: Sequence[float]) -> list[float] | None:
    """Iglewicz-Hoaglin modified z-scores 0.6745 (x - median) / MAD; None when MAD is 0."""
    vals = [clean(v) for v in values]
    median = clean(statistics.median(vals))
    mad = clean(statistics.median([clean(abs(v - median)) for v in vals]))
    if mad == 0:
        return None
    return [clean(MAD_CONSTANT * clean(v - median) / mad) for v in vals]


# ------------------------------------------------------------------------------ helpers

def _group_of(r: MeasurementRecord) -> QualityGroup:
    return QualityGroup(r.polymer, r.method, r.matrix, matrix_detail_key(r), r.kind, r.basis,
                        r.canonical_unit)


def _group_sort(g: QualityGroup) -> tuple[str, ...]:
    return (g.polymer, g.method, g.matrix.value, g.matrix_detail, g.kind.value, g.basis.value,
            g.canonical_unit.code)


def _ordered(records: Iterable[QualityRecord]) -> tuple[QualityRecord, ...]:
    return tuple(sorted(records, key=lambda x: (x.ref.sheet, x.ref.source_row,
                                                x.ref.source_column, x.ref.file_sha256)))


def signal_key(rule: QualityRule, group: QualityGroup, subject: Mapping[str, str],
               refs: Iterable[RecordRef]) -> str:
    """Content-only key: version, rule, group, subject and the identity of the contributing
    cells (file fingerprint, sheet, row, column). Never the import id, the order or a figure."""
    payload = {
        "v": QUALITY_RULES_VERSION,
        "rule": str(rule),
        "group": [group.polymer, group.method, group.matrix.value, group.matrix_detail,
                  group.kind.value, group.basis.value, group.canonical_unit.code],
        "subject": dict(subject),
        "records": sorted([r.file_sha256, r.sheet, r.source_row, r.source_column] for r in refs),
    }
    text = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _signal(rule: QualityRule, group: QualityGroup, subject: dict[str, str],
            records: Iterable[QualityRecord], figures: Sequence[tuple[str, float]], *,
            sample_id: str | None = None, aliquot: str | None = None,
            blank: BlankSummary | None = None,
            dimension: Literal["batch", "analysis_date"] | None = None,
            stratum: str | None = None) -> Signal:
    ordered = _ordered(records)
    key = signal_key(rule, group, subject, [x.ref for x in ordered])
    return Signal(key, rule, group, sample_id, aliquot, blank, dimension, stratum,
                  tuple((name, float(value)) for name, value in figures), ordered)


def _quantified_value(qrec: QualityRecord) -> float:
    value = qrec.record.canonical_value
    assert value is not None  # is_quantified guarantees it
    return value


# ------------------------------------------------------------------------- a) aliquots

def _aliquot_discordance(samples: list[QualityRecord]) -> list[Signal]:
    by_sample: dict[tuple[QualityGroup, str], list[QualityRecord]] = defaultdict(list)
    for x in samples:
        by_sample[(_group_of(x.record), x.record.sample_id)].append(x)
    out: list[Signal] = []
    for (group, sample_id), rows in by_sample.items():
        quantified = [x for x in rows if is_quantified(x.record)]
        if len(quantified) < 2:
            continue
        values = [clean(_quantified_value(x)) for x in quantified]
        rpd = relative_range(values)
        if not rpd > ALIQUOT_RPD_THRESHOLD:
            continue
        out.append(_signal(
            QualityRule.aliquot_discordance, group, {"sample": sample_id}, quantified,
            [("n_aliquots", len(rows)), ("n_quantified", len(quantified)),
             ("min", min(values)), ("max", max(values)), ("mean", clean(statistics.fmean(values))),
             ("rpd_percent", clean(rpd * 100)), ("threshold_percent", ALIQUOT_RPD_THRESHOLD * 100)],
            sample_id=sample_id))
    return out


# ---------------------------------------------------------------------------- b) blanks

def _near_blank(samples: list[QualityRecord], blanks: Sequence[BlankSummary]
                ) -> tuple[list[Signal], list[QualityNote]]:
    out: list[Signal] = []
    notes: list[QualityNote] = []
    if not samples:
        return out, notes
    procedural = [b for b in blanks if b.kind == _PROCEDURAL_BLANK]
    if not procedural:
        notes.append(QualityNote(QualityRule.near_blank, NoteReason.no_blank_summary, None))
        return out, notes

    usable: list[BlankSummary] = []
    units: dict[str, Unit] = {}
    for b in procedural:
        if b.mean is None or not b.mean > 0:
            notes.append(QualityNote(QualityRule.near_blank, NoteReason.blank_mean_missing,
                                     None, blank=b))
            continue
        unit = parse_unit(b.unit_code)
        if unit is None:
            notes.append(QualityNote(QualityRule.near_blank, NoteReason.blank_unit_unknown,
                                     None, blank=b))
            continue
        usable.append(b)
        units[b.id] = unit

    def blank_polymer(b: BlankSummary, x: QualityRecord) -> str:
        return normalize_result_polymer(b.polymer, x.record.technique)

    without: set[str] = set()
    for x in samples:
        if not any(blank_polymer(b, x) == x.record.polymer for b in procedural):
            without.add(x.record.polymer)
    if without:
        notes.append(QualityNote(QualityRule.near_blank, NoteReason.polymers_without_blank,
                                 None, polymers=tuple(sorted(without))))

    mismatched: set[tuple[QualityGroup, str]] = set()
    for x in samples:
        r = x.record
        if not is_quantified(r):
            continue
        group = _group_of(r)
        value = clean(_quantified_value(x))
        for b in usable:
            if blank_polymer(b, x) != r.polymer:
                continue
            unit = units[b.id]
            assert b.mean is not None
            try:
                mean = clean(convert(b.mean, unit, r.canonical_unit))
            except UnitMismatchError:
                if (group, b.id) not in mismatched:
                    mismatched.add((group, b.id))
                    notes.append(QualityNote(QualityRule.near_blank,
                                             NoteReason.blank_unit_mismatch, group, blank=b))
                continue
            ratio = clean(value / mean)
            if not ratio < NEAR_BLANK_FACTOR:
                continue
            out.append(_signal(
                QualityRule.near_blank, group,
                {"sample": r.sample_id, "aliquot": r.aliquot, "blank": b.id}, [x],
                [("value", value), ("blank_mean", mean), ("blank_mean_reported", b.mean),
                 ("blank_n", b.n), ("ratio", ratio), ("factor", NEAR_BLANK_FACTOR)],
                sample_id=r.sample_id, aliquot=r.aliquot, blank=b))
    return out, notes


# --------------------------------------------------------------------------- c) outliers

def _outliers(samples: list[QualityRecord]) -> tuple[list[Signal], list[QualityNote]]:
    out: list[Signal] = []
    notes: list[QualityNote] = []
    sample_records = [x.record for x in samples]
    by_sample: dict[tuple[str, ...], list[QualityRecord]] = defaultdict(list)
    for x in samples:
        r = x.record
        if is_quantified(r):
            by_sample[(r.sample_id, r.matrix.value, matrix_detail_key(r), r.polymer, r.method,
                       r.kind.value, r.basis.value)].append(x)

    groups: dict[QualityGroup, list[tuple[str, float, list[QualityRecord]]]] = defaultdict(list)
    for res in aggregate_aliquots(sample_records):
        group = QualityGroup(res.polymer, res.method, res.matrix, res.matrix_detail, res.kind,
                             res.basis, res.canonical_unit)
        entries = groups[group]  # creates the group even when nothing is quantified
        if res.status == DetectionStatus.quantified and res.value is not None:
            rows = by_sample[(res.sample_id, res.matrix.value, res.matrix_detail, res.polymer,
                              res.method, res.kind.value, res.basis.value)]
            entries.append((res.sample_id, clean(res.value), rows))

    for group in sorted(groups, key=_group_sort):
        entries = groups[group]
        if len(entries) < OUTLIER_MIN_SAMPLES:
            notes.append(QualityNote(QualityRule.robust_outlier, NoteReason.too_few_samples,
                                     group, count=len(entries)))
            continue
        values = [value for _, value, _ in entries]
        scores = modified_z_scores(values)
        if scores is None:
            notes.append(QualityNote(QualityRule.robust_outlier, NoteReason.zero_mad, group,
                                     count=len(entries)))
            continue
        median = clean(statistics.median(values))
        mad = clean(statistics.median([clean(abs(v - median)) for v in values]))
        for (sample_id, value, rows), z in zip(entries, scores, strict=True):
            if not abs(z) > OUTLIER_Z_THRESHOLD:
                continue
            out.append(_signal(
                QualityRule.robust_outlier, group, {"sample": sample_id}, rows,
                [("value", value), ("median", median), ("mad", mad), ("z", z),
                 ("n", len(entries)), ("threshold", OUTLIER_Z_THRESHOLD)],
                sample_id=sample_id))
    return out, notes


# ------------------------------------------------------------------------- d) LOD rates

_DIMENSIONS: tuple[Literal["batch", "analysis_date"], ...] = ("batch", "analysis_date")


def _stratum_value(r: MeasurementRecord, dimension: str) -> str:
    return (r.batch if dimension == "batch" else r.analysis_date).strip()


def _lod_rates(samples: list[QualityRecord]) -> tuple[list[Signal], list[QualityNote]]:
    out: list[Signal] = []
    notes: list[QualityNote] = []
    analysed = [x for x in samples if x.record.status != DetectionStatus.not_analysed]
    tests = 0
    for dimension in _DIMENSIONS:
        if not any(_stratum_value(x.record, dimension) for x in analysed):
            if samples:
                notes.append(QualityNote(QualityRule.unusual_lod_rate,
                                         NoteReason.dimension_empty, None, dimension=dimension))
            continue
        by_group: dict[QualityGroup, dict[str, list[QualityRecord]]] = defaultdict(
            lambda: defaultdict(list))
        for x in analysed:
            value = _stratum_value(x.record, dimension)
            if value:
                by_group[_group_of(x.record)][value].append(x)
        for group in sorted(by_group, key=_group_sort):
            strata = by_group[group]
            total = sum(len(rows) for rows in strata.values())

            def below(rows: list[QualityRecord]) -> int:
                return sum(1 for x in rows if x.record.status == DetectionStatus.below_lod)

            k_all = below([x for rows in strata.values() for x in rows])
            eligible = [s for s in sorted(strata)
                        if len(strata[s]) >= LOD_RATE_MIN_STRATUM
                        and total - len(strata[s]) >= LOD_RATE_MIN_STRATUM]
            if not eligible:
                notes.append(QualityNote(QualityRule.unusual_lod_rate,
                                         NoteReason.too_few_in_strata, group,
                                         dimension=dimension))
                continue
            stats: dict[str, tuple[int, int, int, int, float]] = {}
            for s in eligible:
                n_s, k_s = len(strata[s]), below(strata[s])
                n_r, k_r = total - n_s, k_all - k_s
                _, p = fisher_exact([[k_s, n_s - k_s], [k_r, n_r - k_r]],
                                    alternative="two-sided")
                stats[s] = (k_s, n_s, k_r, n_r, float(p))
            if len(strata) == 2:  # symmetric: one test, on the stratum with the higher rate
                tested = [sorted(eligible, key=lambda s: (-stats[s][0] / stats[s][1], s))[0]]
            else:
                tested = eligible
            tests += len(tested)
            for s in tested:
                k_s, n_s, k_r, n_r, p = stats[s]
                if not p < LOD_RATE_ALPHA:
                    continue
                out.append(_signal(
                    QualityRule.unusual_lod_rate, group, {"dimension": dimension, "stratum": s},
                    strata[s],
                    [("k_stratum", k_s), ("n_stratum", n_s), ("k_rest", k_r), ("n_rest", n_r),
                     ("rate_stratum_percent", 100 * k_s / n_s),
                     ("rate_rest_percent", 100 * k_r / n_r), ("p_value", p),
                     ("alpha", LOD_RATE_ALPHA)],
                    dimension=dimension, stratum=s))
    if tests:
        notes.append(QualityNote(QualityRule.unusual_lod_rate, NoteReason.tests_performed, None,
                                 count=tests))
    return out, notes


# ------------------------------------------------------------------------------ assess

def _signal_sort(s: Signal) -> tuple[object, ...]:
    return (_RULE_ORDER[s.rule], _group_sort(s.group), s.dimension or "", s.stratum or "",
            s.sample_id or "", s.aliquot or "", s.blank.id if s.blank else "")


def _note_sort(n: QualityNote) -> tuple[object, ...]:
    return (_RULE_ORDER[n.rule], _REASON_ORDER[n.reason],
            _group_sort(n.group) if n.group else (),
            _DIMENSIONS.index(n.dimension) if n.dimension in _DIMENSIONS else -1,
            n.blank.id if n.blank else "", n.polymers)


def assess_quality(records: Iterable[QualityRecord],
                   blanks: Iterable[BlankSummary] = ()) -> QualityResult:
    samples = [x for x in records if x.record.record_type == RecordType.sample]
    blank_list = list(blanks)
    signals: list[Signal] = []
    notes: list[QualityNote] = []

    signals += _aliquot_discordance(samples)
    near, near_notes = _near_blank(samples, blank_list)
    signals += near
    notes += near_notes
    outliers, outlier_notes = _outliers(samples)
    signals += outliers
    notes += outlier_notes
    lod, lod_notes = _lod_rates(samples)
    signals += lod
    notes += lod_notes

    return QualityResult(
        QUALITY_RULES_VERSION,
        tuple(sorted(signals, key=_signal_sort)),
        tuple(sorted(notes, key=_note_sort)))
