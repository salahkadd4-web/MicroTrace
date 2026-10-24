"""Traceable Parquet spectral catalogue (raw + preprocessed spectra with provenance)."""
from __future__ import annotations

import json
import subprocess
import warnings
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from microtrace_core import readers
from microtrace_core.readers.common import sha256_file
from microtrace_core.preprocess import GRIDS, PREPROCESS_VERSION, coverage, diagnostic_coverage, preprocess

CATALOG_NAME = "spectra_catalog.parquet"
META_NAME = "catalog_meta.json"
DATA_NATURE = "reference/environmental polymers — not human biological matrices"

_SCHEMA = pa.schema([
    ("spectrum_id", pa.string()), ("source", pa.string()), ("technique", pa.string()),
    ("polymer", pa.string()), ("polymer_raw", pa.string()), ("state", pa.string()),
    ("sample_group", pa.string()), ("file", pa.string()), ("file_sha256", pa.string()),
    ("laser_nm", pa.float64()), ("x_unit", pa.string()), ("y_unit", pa.string()),
    ("label_note", pa.string()),
    ("coverage", pa.float64()), ("diagnostic_coverage", pa.float64()),
    ("x_raw", pa.list_(pa.float64())), ("y_raw", pa.list_(pa.float64())),
    ("y_grid", pa.list_(pa.float32())), ("extra", pa.string()),
])


def _git(*args: str) -> str:
    res = subprocess.run(
        ["git", *args], cwd=Path(__file__).resolve().parent,
        capture_output=True, text=True, timeout=10, check=True)
    return res.stdout


def _git_commit() -> str:
    """HEAD commit of the repository containing this package, or "unknown"."""
    try:
        return _git("rev-parse", "HEAD").strip() or "unknown"
    except Exception:
        return "unknown"


def _git_dirty() -> bool | str:
    """True if the working tree has uncommitted changes, "unknown" if git fails."""
    try:
        return bool(_git("status", "--porcelain").strip())
    except Exception:
        return "unknown"


def _grids_meta() -> dict[str, list[float]]:
    return {t: [float(g[0]), float(g[-1]), float(g[1] - g[0])] for t, g in GRIDS.items()}


def build_catalog(datasets_root: Path, out_dir: Path) -> dict:
    """Read every library, preprocess, and write the catalogue and its metadata."""
    datasets_root, out_dir = Path(datasets_root), Path(out_dir)
    rows: list[dict] = []
    seen: set[str] = set()
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        for s in readers.iter_all(datasets_root):
            if s.spectrum_id in seen:
                raise ValueError(f"duplicate spectrum_id: {s.spectrum_id}")
            seen.add(s.spectrum_id)
            y_grid = preprocess(s)
            rows.append({
                "spectrum_id": s.spectrum_id, "source": s.source,
                "technique": s.technique, "polymer": s.polymer,
                "polymer_raw": s.polymer_raw, "state": s.state,
                "sample_group": s.sample_group, "file": s.file,
                "file_sha256": sha256_file(datasets_root / s.file),
                "laser_nm": None if s.laser_nm is None else float(s.laser_nm),
                "x_unit": s.x_unit, "y_unit": s.y_unit, "label_note": s.label_note,
                "coverage": coverage(y_grid),
                "diagnostic_coverage": diagnostic_coverage(y_grid, s.technique),
                "x_raw": s.x.tolist(), "y_raw": s.y.tolist(),
                "y_grid": y_grid.tolist(),
                "extra": json.dumps(s.extra, sort_keys=True),
            })
    messages = [str(w.message) for w in caught]
    messages += [
        f"{r['spectrum_id']}: coverage 0 on the {r['technique']} grid "
        "(off-grid spectrum, probable unit error)"
        for r in rows if r["coverage"] == 0.0
    ]

    out_dir.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pylist(rows, schema=_SCHEMA)
    pq.write_table(table, out_dir / CATALOG_NAME)
    meta = {
        "built_at": datetime.now(UTC).isoformat(),
        "preprocess_version": PREPROCESS_VERSION,
        "grids": _grids_meta(),
        "data_nature": DATA_NATURE,
        "git_commit": _git_commit(),
        "git_dirty": _git_dirty(),
        "counts": {
            "by_source": dict(Counter(r["source"] for r in rows)),
            "by_technique": dict(Counter(r["technique"] for r in rows)),
            "by_polymer": dict(Counter(r["polymer"] for r in rows)),
        },
        "warnings": messages,
    }
    (out_dir / META_NAME).write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return meta


def load_catalog(path: Path) -> pd.DataFrame:
    """Read a catalogue written by build_catalog."""
    return pq.read_table(Path(path)).to_pandas()


def grid_matrix(df: pd.DataFrame) -> np.ndarray:
    """Stack y_grid into a float32 (n, len(grid)) matrix; one technique only."""
    techniques = set(df["technique"])
    if len(techniques) > 1:
        raise ValueError(f"mixed techniques: {sorted(techniques)}")
    if not len(df):
        raise ValueError("empty catalogue selection")
    return np.vstack([np.asarray(v, dtype=np.float32) for v in df["y_grid"]])
