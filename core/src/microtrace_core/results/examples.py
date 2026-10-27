"""Fictitious "Leslie-like" example dataset: données fictives (simulated).

Every value below is simulated / fictif: nothing comes from a real laboratory.
The wide table is built so that, after import, it reproduces the *shape* of the
frequencies and maxima reported in Leslie 2022 (section 3.2) -- 22 donors,
PET 11, PS_SUM 8, PE 5, PMMA 1, PP 0, any polymer 17 quantified donors; maxima of
individual quantified measurements PET 2.4, PS_SUM 4.8, PE 7.1 ug/mL -- with
fictitious values and the detection limits of Table 3 of that article.
"""
from __future__ import annotations

from importlib import resources

from microtrace_core.results.mapping import Mapping, suggest_mapping
from microtrace_core.results.records import DetectionLimit, MethodSpec, StudyContext
from microtrace_core.results.tables import RawTable, read_table
from microtrace_core.results.vocab import DataNature, Technique

LESLIE_LIKE_FILENAME = "exemple_fictif_leslie2022.csv"

PYGC = "Py-GC/MS"
UG_ML = "µg/mL"
LIMITS_SOURCE = "Leslie et al. 2022, Tableau 3"

# Table 3 of Leslie 2022: polymer -> (LOD, LOQ) in ug/mL (PS entered as PS_SUM).
LESLIE_LIMITS: dict[str, tuple[float, float]] = {
    "PMMA": (0.10, 0.33), "PP": (0.68, 2.3), "PS_SUM": (0.34, 1.1),
    "PE": (0.61, 2.0), "PET": (0.13, 0.43),
}
_COLUMNS = ("PMMA", "PP", "PS", "PE", "PET")
_SINGLE_ALIQUOT = {6, 9, 15, 18}
# donor -> (value of aliquot a, value of aliquot b); None keeps the default censoring.
_QUANTIFIED: dict[str, dict[int, tuple[str, str]]] = {
    "PET": {1: ("2,4", "1,8"), 2: ("0,9", "<LOD"), 3: ("1,1", "*0,3"), 4: ("0,6", "0,5"),
            5: ("1,3", "<LOD"), 6: ("0,7", ""), 7: ("0,5", "*0,2"), 8: ("1,9", "1,2"),
            9: ("0,8", ""), 10: ("0,45", "<LOD"), 11: ("1,0", "0,7")},
    "PS": {5: ("2,2", "<LOD"), 6: ("1,5", ""), 7: ("3,1", "*0,5"), 12: ("4,8", "2,6"),
           13: ("1,2", "<LOD"), 14: ("2,0", "1,4"), 15: ("1,7", ""), 16: ("3,3", "<LOD")},
    "PE": {2: ("2,5", "*1,0"), 4: ("3,6", "<LOD"), 8: ("2,1", "2,9"),
           16: ("7,1", "4,0"), 17: ("2,4", "<LOD")},
    "PMMA": {3: ("0,5", "<LOD")},
    "PP": {},
}
# a few between-LOD-and-LOQ values for donors that stay unquantified
_BETWEEN = {("PP", 18): "*1,2", ("PP", 19): "*0,9", ("PET", 19): "*0,2",
            ("PE", 20): "*0,8", ("PS", 21): "*0,4", ("PMMA", 22): "*0,12"}


def _aliquot_value(col: str, donor: int, idx: int) -> str:
    pair = _QUANTIFIED[col].get(donor)
    if pair is not None:
        return pair[idx]
    if idx == 0 and (col, donor) in _BETWEEN:
        return _BETWEEN[(col, donor)]
    return "<LOD"


def leslie_like_csv() -> bytes:
    """UTF-8 bytes of the simulated / fictif wide table (22 donors, aliquots a/b)."""
    lines = ["Donor;" + ";".join(_COLUMNS)]
    for donor in range(1, 23):
        for idx, letter in enumerate("ab"):
            if letter == "b" and donor in _SINGLE_ALIQUOT:
                continue
            cells = [_aliquot_value(c, donor, idx) for c in _COLUMNS]
            lines.append(f"{donor}{letter};" + ";".join(cells))
    return ("\n".join(lines) + "\n").encode("utf-8")


def leslie_like_wide_table(filename: str = LESLIE_LIKE_FILENAME) -> RawTable:
    """Simulated / fictif wide table read from :func:`leslie_like_csv`."""
    return read_table(leslie_like_csv(), filename)


def leslie_like_context() -> StudyContext:
    limits = tuple(DetectionLimit(PYGC, p, lod, loq, UG_ML, LIMITS_SOURCE)
                   for p, (lod, loq) in LESLIE_LIMITS.items())
    return StudyContext(DataNature.simulated, (MethodSpec(PYGC, Technique.py_gc_ms),), limits)


def leslie_like_mapping(table: RawTable | None = None) -> Mapping:
    base = suggest_mapping(table or leslie_like_wide_table())
    return Mapping(
        base.mode, base.field_columns, base.polymer_columns,
        {"matrix": "sang total", "unit": UG_ML, "method": PYGC}, split_aliquot_suffix=True)


# --- Real data: Leslie et al. 2022, Table S2 of the supplementary material (CC BY 4.0) ---
LESLIE_2022_FILENAME = "leslie2022_tableau_S2.csv"
LESLIE_2022_DOI = "10.1016/j.envint.2022.107199"
LESLIE_2022_LICENSE = "CC BY 4.0"
_LESLIE_2022_RESOURCE = "data/leslie2022_table_s2.csv"


def leslie_2022_csv() -> bytes:
    """Verbatim Table S2 (22 donors, aliquots a/b), read from the packaged data file."""
    return resources.files("microtrace_core.results").joinpath(_LESLIE_2022_RESOURCE).read_bytes()


def leslie_2022_context() -> StudyContext:
    limits = tuple(DetectionLimit(PYGC, p, lod, loq, UG_ML, LIMITS_SOURCE)
                   for p, (lod, loq) in LESLIE_LIMITS.items())
    return StudyContext(
        DataNature.published, (MethodSpec(PYGC, Technique.py_gc_ms),), limits,
        reference_doi=LESLIE_2022_DOI, reference_license=LESLIE_2022_LICENSE)


def leslie_2022_mapping(table: RawTable | None = None) -> Mapping:
    base = suggest_mapping(table or read_table(leslie_2022_csv(), LESLIE_2022_FILENAME))
    return Mapping(
        base.mode, base.field_columns, base.polymer_columns,
        {"matrix": "sang total", "unit": UG_ML, "method": PYGC}, split_aliquot_suffix=True)
