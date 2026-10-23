"""Helpers shared by the library readers."""
from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np


def read_xy(path: Path, delimiter: str | None, skip_rows: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """Read the first two numeric columns of a text file.

    `delimiter=None` splits on any whitespace. Blank lines, missing trailing cells
    and non-numeric rows are skipped, so no NaN is ever produced.
    """
    xs: list[float] = []
    ys: list[float] = []
    with path.open("r", encoding="utf-8-sig", errors="replace") as fh:
        for i, line in enumerate(fh):
            if i < skip_rows:
                continue
            parts = [p.strip() for p in (line.split(delimiter) if delimiter else line.split())]
            if len(parts) < 2 or not parts[0] or not parts[1]:
                continue
            try:
                x, y = float(parts[0]), float(parts[1])
            except ValueError:
                continue
            xs.append(x)
            ys.append(y)
    return np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def rel_posix(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()
