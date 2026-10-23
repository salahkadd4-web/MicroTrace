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


MPX_DIR = ("Spectres", "10.22000-1820", "data", "dataset")


def mpx_record(file: str, **overrides) -> dict:
    """A MicroPlastiX metadata record (keys as in the real metadata.json)."""
    rec = {
        "index": 0, "Region": "VLFR", "Campaign": "C1", "State": "dry",
        "Treatment": "nobio", "Analysis": "ATR", "Exposure_days": 30,
        "Polymer_ID": 9, "file_legacy": None, "LocationDescription": None,
        "Country": None, "LAT": None, "LON": None, "Replicate": 1,
        "Polymer": "(09) PET", "Product_ID": None, "Supplier": None,
        "Specifications": None, "SpecNo": None, "ATRcorrection": None,
        "BaselineCorrection": None, "file": file, "spec_hash": "abc",
        "x_unit": "cm-1", "y_unit": "A",
    }
    rec.update(overrides)
    return rec


def make_mpx(root: Path, records: list[dict], files: dict[str, Points]) -> Path:
    """Write the MicroPlastiX folder: metadata.json (pandas table orient) and csv files.

    Each csv has ONE header line then comma-separated pairs. Records whose file is not
    in `files` stay referenced in metadata.json but are not written.
    """
    import json

    base = root.joinpath(*MPX_DIR)
    base.mkdir(parents=True, exist_ok=True)
    (base / "metadata.json").write_text(
        json.dumps({"schema": {"fields": []}, "data": records}), encoding="utf-8")
    (base / "spectra.zip").write_bytes(b"junk")
    for name, pts in files.items():
        (base / name).write_text(
            "cm-1,A" + chr(10) + "".join(f"{x},{y}" + chr(10) for x, y in pts), encoding="utf-8")
    return base


def make_raspi(root: Path, spectra: dict[str, Points],
               meta_rows: list[list[str]], trailing: int = 3) -> Path:
    """Write RaSPI_raw.csv (ragged, trailing empty cells) and RaSPI_metadata.csv (BOM)."""
    import csv

    base = root / "Spectres"
    base.mkdir(parents=True, exist_ok=True)
    with (base / "RaSPI_raw.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Spectrum ID"] + [""] * 14)
        for sid, pts in spectra.items():
            empty = [""] * trailing
            w.writerow([sid, "wavenumber", *[x for x, _ in pts], *empty])
            w.writerow(["", "intensity", *[y for _, y in pts], *empty])
    with (base / "RaSPI_metadata.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Spectra ID", "Colour", "Origin", "Additional Information",
                    "Plastic Type", "Laser (nm)", "Diffraction Grating (mm/line)"])
        w.writerows(meta_rows)
    return base
