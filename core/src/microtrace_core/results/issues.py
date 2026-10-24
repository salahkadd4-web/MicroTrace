"""Validation issues shared by the results pipeline."""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class Issue:
    code: str
    severity: Literal["error", "warning", "info"]
    message: str
    row: int | None = None
    column: str | None = None


def has_errors(issues: Iterable[Issue]) -> bool:
    return any(i.severity == "error" for i in issues)
