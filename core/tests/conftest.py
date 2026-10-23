"""Helpers writing synthetic dataset trees (never touches the real datasets/)."""
from __future__ import annotations

from pathlib import Path

import openpyxl

Points = list[tuple[float, float]]


def synthetic_points(n: int = 12, start: float = 400.0, step: float = 10.0) -> Points:
    return [(start + i * step, float(i * i + 1)) for i in range(n)]


def make_flopp(root: Path, variant: str, files: dict[str, Points]) -> Path:
    """Write `Spectres/<variant> .csv/<name>` (2 comma columns, scientific notation)."""
    folder = root / "Spectres" / f"{variant} .csv"
    folder.mkdir(parents=True, exist_ok=True)
    for name, pts in files.items():
        (folder / name).write_text(
            "".join(f"{x:.6e},{y:.6e}\n" for x, y in pts), encoding="utf-8")
    return folder


def make_slopp(root: Path, variant: str, files: dict[str, Points]) -> Path:
    """Write `Spectres/SLoPP and SLoPP-E/<variant>/<folder/name>.txt` (tab separated).

    Keys are relative paths like "Polyethylene/Polyethylene 1. Blue Sphere.txt";
    a sibling .l6s (junk) is written next to each .txt, plus a variant .sdbx.
    """
    base = root / "Spectres" / "SLoPP and SLoPP-E" / variant
    base.mkdir(parents=True, exist_ok=True)
    (base / f"{variant}.sdbx").write_bytes(b"junk")
    for rel, pts in files.items():
        path = base / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(f"{x}\t{y}\n" for x, y in pts), encoding="utf-8")
        path.with_suffix(".l6s").write_bytes(b"\x00\x01 not a spectrum")
    return base


WEATHERED_DIR = "A Raman database of microplastics weathered under natural environments"


def make_weathered(root: Path, files: dict[str, Points],
                   rows: list[tuple] | None = None) -> Path:
    """Write the weathered Raman folder: txt files and an optional content.xlsx.

    `rows` are data rows (ID, type, score, included, id_in_rdsp, remarks); they are
    preceded by a legend row and a header row, with a second header between the
    sta-* and wea-* rows, as in the real file.
    """
    base = root / "Spectres" / WEATHERED_DIR
    base.mkdir(parents=True, exist_ok=True)
    for name, pts in files.items():
        (base / name).write_text("".join(f"{x}\t{y}\n" for x, y in pts), encoding="utf-8")
    if rows is not None:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "content"
        header = ("ID", "type", "Score form KnowItAll", "Inclued in RDSP",
                  "ID in RDSP", "Remarks")
        ws.append(("Legend: long explanatory text", None, None, None, None, "More legend"))
        ws.append(header)
        sta = [r for r in rows if str(r[0]).startswith("sta-")]
        wea = [r for r in rows if not str(r[0]).startswith("sta-")]
        for r in sta:
            ws.append(r)
        ws.append(header)
        for r in wea:
            ws.append(r)
        ws.append((None,) * 6)
        wb.save(base / "content.xlsx")
    return base
