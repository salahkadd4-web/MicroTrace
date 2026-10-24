"""Import orchestrator: personal data -> mapping -> row validation -> file rules."""
from __future__ import annotations

from dataclasses import dataclass

from microtrace_core.results.issues import Issue, has_errors
from microtrace_core.results.mapping import Mapping, apply_mapping
from microtrace_core.results.privacy import detect_pii
from microtrace_core.results.records import MeasurementRecord, StudyContext
from microtrace_core.results.tables import RawTable
from microtrace_core.results.validation import validate_rows
from microtrace_core.results.vocab import DataNature, RecordType

RULES_VERSION = "1"


@dataclass(frozen=True)
class ImportResult:
    records: tuple[MeasurementRecord, ...]
    qc_records: tuple[MeasurementRecord, ...]
    issues: tuple[Issue, ...]
    n_rows: int
    rules_version: str

    @property
    def has_errors(self) -> bool:
        return has_errors(self.issues)


def _file_rules(records: list[MeasurementRecord], context: StudyContext) -> list[Issue]:
    issues: list[Issue] = []
    if len({(r.kind, r.basis) for r in records}) > 1:
        issues.append(Issue(
            "W_MIXED_QUANTITY_KINDS", "warning",
            "Le fichier mêle plusieurs grandeurs ou bases (masse et nombre, par volume et "
            "par masse) : elles ne seront jamais agrégées ensemble."))
    if context.data_nature is DataNature.published and not (
            (context.reference_doi or "").strip() and (context.reference_license or "").strip()):
        issues.append(Issue(
            "E_PUBLISHED_WITHOUT_REFERENCE", "error",
            "Des données publiées exigent un DOI de référence et une licence."))
    return issues


def run_import(table: RawTable, mapping: Mapping, context: StudyContext) -> ImportResult:
    issues: list[Issue] = list(detect_pii(table, mapping))
    rows, map_issues = apply_mapping(table, mapping)
    issues.extend(map_issues)
    records: list[MeasurementRecord] = []
    if not has_errors(map_issues):
        records, row_issues = validate_rows(rows, context)
        issues.extend(row_issues)
        issues.extend(_file_rules(records, context))
    if has_errors(issues):
        return ImportResult((), (), tuple(issues), len(table.rows), RULES_VERSION)
    return ImportResult(
        tuple(r for r in records if r.record_type is RecordType.sample),
        tuple(r for r in records if r.record_type is not RecordType.sample),
        tuple(issues), len(table.rows), RULES_VERSION)
