"""Build the packaged CSV of Leslie et al. 2022 Table S2 from the supplementary .docx.

Usage: python scripts/build_leslie_s2.py <mmc1.docx> [output.csv]

Standard library only. Reads the 2nd table of the document; each value cell holds one
paragraph per aliquot (a, b). Values are copied verbatim; the shape is validated and
the script fails loudly on any deviation.
"""
from __future__ import annotations

import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
POLYMERS = ("PMMA", "PP", "PS", "PE", "PET")
SINGLE_ALIQUOT = {6, 9, 15, 18}
DEFAULT_OUT = (Path(__file__).resolve().parent.parent
               / "core/src/microtrace_core/results/data/leslie2022_table_s2.csv")
VALUE = re.compile(r"^(<\d+(\.\d+)?|\d+(\.\d+)?\*?)$")


def _paras(cell: ET.Element) -> list[str]:
    out = ["".join(t.text or "" for t in p.iter(W + "t")).strip() for p in cell.findall(W + "p")]
    return [p for p in out if p]


def build(docx: Path) -> str:
    with zipfile.ZipFile(docx) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    tables = list(root.iter(W + "tbl"))
    if len(tables) < 2:
        raise SystemExit(f"expected at least 2 tables, found {len(tables)}")
    rows = tables[1].findall(W + "tr")
    header = [_paras(c) for c in rows[0].findall(W + "tc")]
    names = [h[0] for h in header]
    if names != ["donor", *POLYMERS]:
        raise SystemExit(f"unexpected header: {header}")
    body = rows[1:]
    if len(body) != 22:
        raise SystemExit(f"expected 22 donor rows, found {len(body)}")
    lines = ["Donor;" + ";".join(POLYMERS)]
    for n, tr in enumerate(body, start=1):
        cells = [_paras(c) for c in tr.findall(W + "tc")]
        if len(cells) != 6:
            raise SystemExit(f"donor {n}: expected 6 cells, found {len(cells)}")
        labels = [re.sub(r"\s+", "", s) for s in cells[0]]
        expected = [f"{n}a"] if n in SINGLE_ALIQUOT else [f"{n}a", f"{n}b"]
        # donor 9's label cell reads "9a 9b" although its b values are empty in the source:
        # the aliquots actually measured are decided by the values, not by the label.
        if labels[:1] != expected[:1] or (n not in SINGLE_ALIQUOT and labels != expected):
            raise SystemExit(f"donor {n}: aliquot labels {labels}, expected {expected}")
        for c in cells[1:]:
            if len(c) != len(expected):
                raise SystemExit(f"donor {n}: {len(c)} values for {len(expected)} aliquots: {c}")
            for v in c:
                if not VALUE.match(v):
                    raise SystemExit(f"donor {n}: unrecognised value {v!r}")
        for i, label in enumerate(expected):
            lines.append(f"{label};" + ";".join(cells[j][i] for j in range(1, 6)))
    if len(lines) - 1 != 40:
        raise SystemExit(f"expected 40 aliquot rows, built {len(lines) - 1}")
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> None:
    if not 2 <= len(argv) <= 3:
        raise SystemExit(__doc__)
    out = Path(argv[2]) if len(argv) == 3 else DEFAULT_OUT
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(build(Path(argv[1])).encode("utf-8"))
    print(f"wrote {out}")


if __name__ == "__main__":
    main(sys.argv)
