"""Validation issues shared by the results pipeline.

``ISSUE_CODES`` is the closed registry of every code the package emits, with its
one severity; ``issue()`` builds an Issue whose severity comes from it. On an
Issue, ``field`` is the standard field concerned and ``column`` the actual
column of the file (None when the value comes from a constant, the study
context, or when the issue is about the whole file).
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

Severity = Literal["error", "warning", "info"]


@dataclass(frozen=True)
class Issue:
    code: str
    severity: Severity
    message: str
    row: int | None = None
    column: str | None = None
    field: str | None = None


ISSUE_CODES: dict[str, str] = {
    # mapping
    "E_MAPPING_UNKNOWN_FIELD": "error",
    "E_MAPPING_UNKNOWN_COLUMN": "error",
    "E_MAPPING_CONFLICT": "error",
    "E_MAPPING_NO_POLYMER_COLUMNS": "error",
    "W_ALIQUOT_SPLIT_FAILED": "warning",
    # personal data
    "E_PII_COLUMN": "error",
    "E_PII_VALUE": "error",
    "W_POSSIBLE_PII_COLUMN": "warning",
    "W_POSSIBLE_BIRTHDATE": "warning",
    # rows
    "E_REQUIRED_MISSING": "error",
    "E_UNKNOWN_MATRIX": "error",
    "E_MATRIX_DETAIL_MISSING": "error",
    "E_UNKNOWN_METHOD": "error",
    "E_UNKNOWN_RECORD_TYPE": "error",
    "E_UNKNOWN_IDENTIFICATION": "error",
    "E_UNKNOWN_STATUS": "error",
    "E_POLYMER_MISSING": "error",
    "W_POLYMER_OTHER": "warning",
    "I_PS_AS_SUM": "info",
    "E_UNKNOWN_UNIT": "error",
    "E_UNPARSABLE_VALUE": "error",
    "E_NEGATIVE_VALUE": "error",
    "E_LIMIT_UNIT_MISMATCH": "error",
    "E_LOD_GT_LOQ": "error",
    "W_LIMIT_CONFLICT": "warning",
    "E_STATUS_VALUE_CONFLICT": "error",
    "W_STATUS_INCONSISTENT": "warning",
    "W_NO_LIMITS": "warning",
    "W_VALUE_BELOW_LOD": "warning",
    "E_DUPLICATE_RECORD": "error",
    "E_SAMPLE_CONFLICT": "error",
    # file
    "W_MIXED_QUANTITY_KINDS": "warning",
    "E_PUBLISHED_WITHOUT_REFERENCE": "error",
}


def issue(code: str, message: str, row: int | None = None, column: str | None = None,
          field: str | None = None) -> Issue:
    """An Issue with the severity registered for ``code`` (KeyError if unregistered)."""
    return Issue(code, ISSUE_CODES[code], message, row, column, field)  # type: ignore[arg-type]


def has_errors(issues: Iterable[Issue]) -> bool:
    return any(i.severity == "error" for i in issues)
