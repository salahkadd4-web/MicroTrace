"""Import orchestrator: personal data -> mapping -> row validation -> file rules."""
from __future__ import annotations

from dataclasses import dataclass, replace

from microtrace_core.results.issues import Issue, has_errors, issue
from microtrace_core.results.mapping import Mapping, apply_mapping
from microtrace_core.results.privacy import detect_pii, header_has_contact
from microtrace_core.results.records import MeasurementRecord, StudyContext
from microtrace_core.results.contact import MAX_SCAN_CHARS
from microtrace_core.results.tables import RawTable
from microtrace_core.results.validation import validate_rows
from microtrace_core.results.vocab import DataNature, RecordType

RULES_VERSION = "2"
# mapping issues dropped when personal data was found: quoting cell values, or listing
# every header (a header may itself be personal data)
_ECHOES_CELLS = frozenset({"W_ALIQUOT_SPLIT_FAILED", "I_UNMAPPED_COLUMN"})


def _names_hidden_header(i: Issue, hidden: set[str]) -> bool:
    return i.column in hidden or any(h in i.message for h in hidden)


def _hide_long_headers(issues: list[Issue], table: RawTable) -> list[Issue]:
    """Last line of defence: a header longer than MAX_SCAN_CHARS (only its prefix is scanned
    for personal data) is never echoed: its issues name it by position, ``column`` None."""
    long = {c: k for k, c in enumerate(table.columns, 1) if len(c) > MAX_SCAN_CHARS}
    if not long:
        return issues
    out: list[Issue] = []
    for i in issues:
        message = i.message
        for col, k in long.items():
            message = message.replace(f"« {col} »", f"n° {k}").replace(col, f"n° {k}")
        out.append(replace(i, message=message, column=None) if i.column in long
                   else replace(i, message=message) if message != i.message else i)
    return out


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
        issues.append(issue(
            "W_MIXED_QUANTITY_KINDS",
            "Le fichier mêle plusieurs grandeurs ou bases (masse et nombre, par volume et "
            "par masse) : elles ne seront jamais agrégées ensemble."))
    if context.data_nature is DataNature.published and not (
            (context.reference_doi or "").strip() and (context.reference_license or "").strip()):
        issues.append(issue(
            "E_PUBLISHED_WITHOUT_REFERENCE",
            "Des données publiées exigent un DOI de référence et une licence."))
    return issues


def run_import(table: RawTable, mapping: Mapping, context: StudyContext) -> ImportResult:
    return _finish(table, _run(table, mapping, context))


def _finish(table: RawTable, result: ImportResult) -> ImportResult:
    return replace(result, issues=tuple(_hide_long_headers(list(result.issues), table)))


def _run(table: RawTable, mapping: Mapping, context: StudyContext) -> ImportResult:
    issues: list[Issue] = list(detect_pii(table, mapping))
    rows, map_issues = apply_mapping(table, mapping)
    if has_errors(issues):
        # personal data: never validate, so that no message can echo a cell value, and drop
        # mapping issues naming a header that holds contact data
        hidden = {c for c in table.columns if header_has_contact(c)}
        issues.extend(i for i in map_issues
                      if i.code not in _ECHOES_CELLS and not _names_hidden_header(i, hidden))
        return ImportResult((), (), tuple(issues), len(table.rows), RULES_VERSION)
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
