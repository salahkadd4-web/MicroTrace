"""Column mapping of raw tables onto the standard schema (long and wide formats)."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Literal

from microtrace_core.polymers import OTHER, UNKNOWN, normalize_polymer
from microtrace_core.results.issues import Issue
from microtrace_core.results.schema import FIELD_NAMES
from microtrace_core.results.tables import RawTable


@dataclass(frozen=True)
class Mapping:
    mode: Literal["long", "wide"]
    field_columns: dict[str, str]
    polymer_columns: dict[str, str] = field(default_factory=dict)
    constants: dict[str, str] = field(default_factory=dict)
    split_aliquot_suffix: bool = False


@dataclass(frozen=True)
class MappedRow:
    fields: dict[str, str]
    source_row: int
    source_column: str


def _norm(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[\s_.\-]", "", stripped)


_SYNONYMS: dict[str, tuple[str, ...]] = {
    "sample_id": ("sample id", "sampleid", "id échantillon", "échantillon", "donor", "donneur"),
    "polymer": ("polymer", "polymère", "polymer type"),
    "reported_value": ("value", "valeur", "concentration", "result", "résultat"),
    "unit": ("unit", "unité", "units"),
    "matrix": ("matrix", "matrice"),
    "method": ("method", "méthode", "technique"),
    "aliquot": ("aliquot", "aliquote", "replicate", "réplicat"),
    "lod": ("lod",),
    "loq": ("loq",),
    "detection_status": ("status", "statut"),
    "record_type": ("type", "sample type"),
}
_LOOKUP: dict[str, str] = {_norm(s): f for f, syns in _SYNONYMS.items() for s in syns}
_GENERIC_ID = "id"  # only applies when no more specific sample synonym matched


def _is_polymer_header(header: str) -> bool:
    return normalize_polymer(header) not in (UNKNOWN, OTHER)


def suggest_mapping(table: RawTable) -> Mapping:
    field_columns: dict[str, str] = {}
    for col in table.columns:
        target = _LOOKUP.get(_norm(col))
        if target and target not in field_columns:
            field_columns[target] = col
    if "sample_id" not in field_columns:
        for col in table.columns:
            if _norm(col) == _GENERIC_ID:
                field_columns["sample_id"] = col
                break
    if "polymer" not in field_columns:
        used = set(field_columns.values())
        polymer_cols = [c for c in table.columns if c not in used and _is_polymer_header(c)]
        if len(polymer_cols) >= 2:
            return Mapping("wide", field_columns, {c: c for c in polymer_cols})
    return Mapping("long", field_columns)


_SUFFIX = re.compile(r"^(.*\d)([a-z])$")  # a digit must precede the letter


def _error(code: str, message: str, column: str | None = None) -> Issue:
    return Issue(code, "error", message, column=column)


def _check_mapping(table: RawTable, mapping: Mapping) -> list[Issue]:
    issues: list[Issue] = []
    known = set(table.columns)
    for name, col in mapping.field_columns.items():
        if name not in FIELD_NAMES:
            issues.append(_error("E_MAPPING_UNKNOWN_FIELD", f"Champ standard inconnu : « {name} ».", col))
        if col not in known:
            issues.append(_error("E_MAPPING_UNKNOWN_COLUMN",
                                 f"La colonne « {col} » associée à « {name} » est absente du tableau.", col))
    for col in mapping.polymer_columns:
        if col not in known:
            issues.append(_error("E_MAPPING_UNKNOWN_COLUMN",
                                 f"La colonne de polymère « {col} » est absente du tableau.", col))
    for name in mapping.constants:
        if name not in FIELD_NAMES:
            issues.append(_error("E_MAPPING_UNKNOWN_FIELD", f"Champ standard inconnu : « {name} »."))
        if name in mapping.field_columns:
            issues.append(_error(
                "E_MAPPING_CONFLICT",
                f"Le champ « {name} » est associé à la fois à une colonne et à une constante.",
                mapping.field_columns[name]))
    if mapping.mode == "wide":
        for name in ("reported_value", "polymer"):
            if name in mapping.field_columns or name in mapping.constants:
                issues.append(_error(
                    "E_MAPPING_CONFLICT",
                    f"En format large, « {name} » provient des colonnes de polymères "
                    "et ne peut être ni associé à une colonne ni fixé par une constante.",
                    mapping.field_columns.get(name)))
        if not mapping.polymer_columns:
            issues.append(_error("E_MAPPING_CONFLICT",
                                 "Le format large exige au moins une colonne de polymère."))
    return issues


def apply_mapping(table: RawTable, mapping: Mapping) -> tuple[list[MappedRow], list[Issue]]:
    issues = _check_mapping(table, mapping)
    if issues:
        return [], issues
    split = (mapping.split_aliquot_suffix and "sample_id" in mapping.field_columns
             and "aliquot" not in mapping.field_columns and "aliquot" not in mapping.constants)
    out: list[MappedRow] = []
    for row, number in zip(table.rows, table.row_numbers, strict=True):
        base: dict[str, str] = dict(mapping.constants)
        for name, col in mapping.field_columns.items():
            base[name] = row.get(col, "")
        if split:
            m = _SUFFIX.match(base["sample_id"])
            if m:
                base["sample_id"], base["aliquot"] = m.group(1), m.group(2)
            else:
                base["aliquot"] = ""
        if mapping.mode == "long":
            out.append(MappedRow(base, number, mapping.field_columns.get("reported_value", "")))
        else:
            for col, label in mapping.polymer_columns.items():
                out.append(MappedRow({**base, "polymer": label, "reported_value": row.get(col, "")},
                                     number, col))
    return out, issues
