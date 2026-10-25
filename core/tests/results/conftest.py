"""Synthetic result tables for the results tests.

Every value below is simulated / fictif: nothing comes from a real laboratory.
The wide table is built so that, after import, it reproduces the *shape* of the
frequencies and maxima reported in Leslie 2022 (section 3.2) -- 22 donors,
PET 11, PS_SUM 8, PE 5, PMMA 1, PP 0, any polymer 17 quantified donors; maxima of
individual quantified measurements PET 2.4, PS_SUM 4.8, PE 7.1 ug/mL -- with
fictitious values and the detection limits of Table 3 of that article.
"""
from __future__ import annotations

from microtrace_core.results.examples import (  # noqa: F401  (re-exported for the tests)
    LESLIE_LIKE_FILENAME,
    LESLIE_LIMITS,
    PYGC,
    UG_ML,
    leslie_like_context,
    leslie_like_csv,
    leslie_like_mapping,
    leslie_like_wide_table,
)
from microtrace_core.results.mapping import Mapping, suggest_mapping
from microtrace_core.results.records import MethodSpec, StudyContext
from microtrace_core.results.tables import RawTable, read_table
from microtrace_core.results.vocab import DataNature, Technique


def particles_long_csv() -> str:
    return (
        "Sample ID;Polymer;Value;Unit\n"
        "P1;PET;12,5;particles/mL\n"
        "P1;PE;<LOD;particles/mL\n"
        "P2;PET;8;particles/mL\n"
        "P2;PS;3,5;particles/mL\n"
    )


def particles_long_table() -> RawTable:
    """Simulated / fictif long table of particle counts per mL (micro-Raman)."""
    return read_table(particles_long_csv().encode("utf-8"), "simulated_particles.csv")


def particles_context() -> StudyContext:
    return StudyContext(DataNature.simulated, (MethodSpec("µRaman", Technique.micro_raman),))


def particles_mapping(table: RawTable | None = None) -> Mapping:
    base = suggest_mapping(table or particles_long_table())
    return Mapping(base.mode, base.field_columns, base.polymer_columns,
                   {"matrix": "sang total", "method": "µRaman"})
