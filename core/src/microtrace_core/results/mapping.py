"""Column mapping of raw tables onto the standard schema (long and wide formats)."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Literal

from microtrace_core.polymers import OTHER, UNKNOWN, normalize_polymer
from microtrace_core.results.issues import Issue, issue
from microtrace_core.results.schema import FIELD_NAMES
from microtrace_core.results.tables import RawTable
from microtrace_core.results.units import parse_unit


@dataclass(frozen=True)
class Mapping:
    """How table columns map onto standard fields. Frozen but not hashable (it holds dicts).

    ``polymer_columns`` (wide mode): file column -> polymer label. ``constants``: field ->
    value applied to every row. ``split_aliquot_suffix``: "12a" / "D01-b" -> sample + aliquot.
    """

    mode: Literal["long", "wide"]
    field_columns: dict[str, str]
    polymer_columns: dict[str, str] = field(default_factory=dict)
    constants: dict[str, str] = field(default_factory=dict)
    split_aliquot_suffix: bool = False


@dataclass(frozen=True)
class MappedRow:
    """One measurement cell with its row fields; ``columns`` maps each standard field read
    from the file to its file column (fields set by a constant are absent)."""

    fields: dict[str, str]
    source_row: int
    source_column: str
    columns: dict[str, str] = field(default_factory=dict)


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


_UNIT_SUFFIX = re.compile(r"^(.*?)\s*(?:\(([^()]*)\)|\[([^\[\]]*)\])\s*$")


def _polymer_label(header: str) -> str:
    """The header without a trailing unit in parentheses or brackets ("PET (µg/mL)" -> "PET")."""
    m = _UNIT_SUFFIX.match(header)
    if m and m.group(1) and parse_unit(m.group(2) or m.group(3) or "") is not None:
        return m.group(1)
    return header


def _is_polymer_header(header: str) -> bool:
    return normalize_polymer(_polymer_label(header)) not in (UNKNOWN, OTHER)


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
            return Mapping("wide", field_columns, {c: _polymer_label(c) for c in polymer_cols})
    return Mapping("long", field_columns)


_SUFFIX = re.compile(r"^(.*\d)[-_]?([A-Za-z])$")  # a digit must precede the letter
_MAX_EXAMPLES = 5


def _check_mapping(table: RawTable, mapping: Mapping) -> list[Issue]:
    """Mapping errors; ``column`` is set only for columns that exist in the file."""
    issues: list[Issue] = []
    known = set(table.columns)

    def present(col: str | None) -> str | None:
        return col if col in known else None

    for name, col in mapping.field_columns.items():
        if name not in FIELD_NAMES:
            issues.append(issue("E_MAPPING_UNKNOWN_FIELD", f"Champ standard inconnu : « {name} ».",
                                column=present(col)))
        if col not in known:
            issues.append(issue(
                "E_MAPPING_UNKNOWN_COLUMN",
                f"La colonne « {col} » associée à « {name} » est absente du tableau.",
                field=name if name in FIELD_NAMES else None))
    for col in mapping.polymer_columns:
        if col not in known:
            issues.append(issue("E_MAPPING_UNKNOWN_COLUMN",
                                f"La colonne de polymère « {col} » est absente du tableau.",
                                field="reported_value"))
    for name in mapping.constants:
        if name not in FIELD_NAMES:
            issues.append(issue("E_MAPPING_UNKNOWN_FIELD", f"Champ standard inconnu : « {name} »."))
        if name in mapping.field_columns:
            issues.append(issue(
                "E_MAPPING_CONFLICT",
                f"Le champ « {name} » est associé à la fois à une colonne et à une constante.",
                column=present(mapping.field_columns[name]), field=name))
    if mapping.mode == "wide":
        for name in ("reported_value", "polymer"):
            if name in mapping.field_columns or name in mapping.constants:
                issues.append(issue(
                    "E_MAPPING_CONFLICT",
                    f"En format large, « {name} » provient des colonnes de polymères "
                    "et ne peut être ni associé à une colonne ni fixé par une constante.",
                    column=present(mapping.field_columns.get(name)), field=name))
        if not mapping.polymer_columns:
            issues.append(issue("E_MAPPING_NO_POLYMER_COLUMNS",
                                "Le format large exige au moins une colonne de polymère.",
                                field="polymer"))
    return issues


def _unmapped(table: RawTable, mapping: Mapping) -> list[Issue]:
    used = set(mapping.field_columns.values()) | set(mapping.polymer_columns)
    return [issue("I_UNMAPPED_COLUMN",
                  f"La colonne « {col} » n'est associée à aucun champ : elle est ignorée.",
                  column=col)
            for col in table.columns if col not in used]


def _split_failed(failed: list[str], column: str) -> Issue:
    examples = ", ".join(f"« {x} »" for x in failed[:_MAX_EXAMPLES])
    return issue(
        "W_ALIQUOT_SPLIT_FAILED",
        f"{len(failed)} identifiant(s) d'échantillon sans suffixe d'aliquote reconnu "
        f"(chiffre suivi d'une lettre, ex. « 12a », « D01-b ») : aliquote laissée vide. "
        f"Exemples : {examples}.", column=column, field="sample_id")


def apply_mapping(table: RawTable, mapping: Mapping) -> tuple[list[MappedRow], list[Issue]]:
    issues = _check_mapping(table, mapping)
    if issues:
        return [], issues
    issues = _unmapped(table, mapping)
    split = (mapping.split_aliquot_suffix and "sample_id" in mapping.field_columns
             and "aliquot" not in mapping.field_columns and "aliquot" not in mapping.constants)
    columns = dict(mapping.field_columns)
    if split:
        columns["aliquot"] = columns["sample_id"]
    out: list[MappedRow] = []
    failed: dict[str, None] = {}  # ordered set of ids without a recognised suffix
    for row, number in zip(table.rows, table.row_numbers, strict=True):
        base: dict[str, str] = dict(mapping.constants)
        for name, col in mapping.field_columns.items():
            base[name] = row.get(col, "")
        if split:
            sid = base["sample_id"].strip(" \xa0\t\r\n")
            m = _SUFFIX.match(sid)
            if m:
                base["sample_id"], base["aliquot"] = m.group(1), m.group(2).lower()
            else:
                base["aliquot"] = ""
                if sid:
                    failed[sid] = None
        if mapping.mode == "long":
            out.append(MappedRow(base, number, mapping.field_columns.get("reported_value", ""),
                                 columns))
        else:
            for col, label in mapping.polymer_columns.items():
                out.append(MappedRow({**base, "polymer": label, "reported_value": row.get(col, "")},
                                     number, col,
                                     {**columns, "polymer": col, "reported_value": col}))
    if failed:
        issues.append(_split_failed(list(failed), columns["sample_id"]))
    return out, issues
