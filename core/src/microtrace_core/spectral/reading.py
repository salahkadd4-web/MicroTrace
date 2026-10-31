"""Read one two-column text spectrum (CSV / TSV / blank separated).

Errors carry an issue code and, at most, a line number or a count: never any file
content, so they are safe to log.
"""
from __future__ import annotations

import math
from enum import StrEnum

import numpy as np

from microtrace_core.spectrum import MIN_POINTS

MAX_SPECTRUM_BYTES = 2 * 1024 * 1024
MAX_POINTS = 100_000
MAX_HEADER_LINES = 50


class ReadIssue(StrEnum):
    EMPTY = "empty"
    BINARY = "binary"
    JCAMP = "jcamp"
    NO_NUMERIC_ROWS = "no_numeric_rows"
    TOO_MANY_HEADER_LINES = "too_many_header_lines"
    NON_NUMERIC_ROW = "non_numeric_row"
    TOO_MANY_COLUMNS = "too_many_columns"
    TOO_FEW_POINTS = "too_few_points"
    TOO_MANY_POINTS = "too_many_points"


class SpectrumReadError(ValueError):
    def __init__(self, issue: ReadIssue, line: int | None = None, count: int | None = None) -> None:
        parts = [str(issue.value)]
        if line is not None:
            parts.append(f"line={line}")
        if count is not None:
            parts.append(f"count={count}")
        super().__init__(" ".join(parts))
        self.issue = issue
        self.line = line
        self.count = count


def _number(cell: str, decimal_comma: bool) -> float | None:
    cell = cell.strip()
    if decimal_comma:
        cell = cell.replace(",", ".")
    if not cell or "_" in cell:
        return None
    try:
        v = float(cell)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def _candidates(line: str) -> list[tuple[list[str], bool]]:
    """Ways to split a line into cells, with whether a decimal comma is allowed."""
    if "\t" in line:
        return [(line.split("\t"), True)]
    if ";" in line:
        return [(line.split(";"), True)]
    if "," in line:
        return [(line.split(","), False), (line.rstrip(",; ").split(), True)]
    return [(line.split(), True)]


def _numeric_cells(line: str) -> list[float] | None:
    """The numbers of a line (trailing empty cells dropped), or None if not all numeric."""
    for cells, decimal_comma in _candidates(line):
        while cells and not cells[-1].strip():
            cells = cells[:-1]
        if not cells:
            continue
        values = [_number(c, decimal_comma) for c in cells]
        if all(v is not None for v in values):
            return values  # type: ignore[return-value]
    return None


def parse_two_columns(data: bytes) -> tuple[np.ndarray, np.ndarray]:
    """Parse a single two-column spectrum; raise SpectrumReadError otherwise."""
    if not data.strip():
        raise SpectrumReadError(ReadIssue.EMPTY)
    if b"\x00" in data:
        raise SpectrumReadError(ReadIssue.BINARY)
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1")

    xs: list[float] = []
    ys: list[float] = []
    headers = 0
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        values = _numeric_cells(line)
        if not xs:  # still before the first data row
            if line.startswith("##"):
                raise SpectrumReadError(ReadIssue.JCAMP)
            if values is None or len(values) < 2:
                headers += 1
                if headers > MAX_HEADER_LINES:
                    raise SpectrumReadError(ReadIssue.TOO_MANY_HEADER_LINES)
                continue
        elif values is None or len(values) < 2:
            raise SpectrumReadError(ReadIssue.NON_NUMERIC_ROW, line=number)
        if len(values) > 2:
            raise SpectrumReadError(ReadIssue.TOO_MANY_COLUMNS, line=number)
        xs.append(values[0])
        ys.append(values[1])
        if len(xs) > MAX_POINTS:
            raise SpectrumReadError(ReadIssue.TOO_MANY_POINTS, count=len(xs))
    if not xs:
        raise SpectrumReadError(ReadIssue.NO_NUMERIC_ROWS)
    if len(xs) < MIN_POINTS:
        raise SpectrumReadError(ReadIssue.TOO_FEW_POINTS, count=len(xs))
    return np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64)
