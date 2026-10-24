"""Column mapping of raw tables onto the standard schema (long and wide formats)."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Literal

from microtrace_core.polymers import OTHER, UNKNOWN, normalize_polymer
from microtrace_core.results.contact import MAX_SCAN_CHARS, header_label
from microtrace_core.results.issues import Issue, issue
from microtrace_core.results.schema import FIELD_NAMES
from microtrace_core.results.tables import RawTable
from microtrace_core.results.units import parse_unit
from microtrace_core.results.vocab import parse_technique


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
    from the file to its file column (fields set by a constant are absent).

    ``header_unit`` (wide format only): the unit text written in the polymer column header
    ("PET (ng/mL)" -> "ng/mL"), checked against the row unit by the validation.
    """

    fields: dict[str, str]
    source_row: int
    source_column: str
    columns: dict[str, str] = field(default_factory=dict)
    header_unit: str | None = None


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


_GROUPS = {")": "(", "]": "["}


def _is_metadata_group(inner: str) -> bool:
    """A bracket group naming limits, signal-to-noise or a technique is not a unit
    ("PET (LOD/LOQ)", "PE (S/N)", "PET (Py-GC/MS)")."""
    low = inner.strip().lower()
    return ("lod" in low or "loq" in low or "s/n" in low or low == "sn"
            or parse_technique(inner) is not None)


def _trailing_group(header: str) -> tuple[str, str] | None:
    """(label, content) of a trailing "(...)" or "[...]" group; linear, and None for a header
    longer than MAX_SCAN_CHARS."""
    if len(header) > MAX_SCAN_CHARS:
        return None
    text = header.rstrip()
    opening = _GROUPS.get(text[-1:])
    if opening is None:
        return None
    start = text.rfind(opening)
    inner = text[start + 1:-1]
    label = text[:start].rstrip()
    if start < 0 or not label or text[-1] in inner:
        return None
    return label, inner


def _unit_suffix(header: str) -> tuple[str, str] | None:
    """(label, unit text) when the header ends with a unit in parentheses or brackets.

    A unit is a group whose content is a known unit or contains "/" ("ng/dL" is kept as an
    unknown unit, "(sum)" or "(lot 2)" are not units), unless it names limits, signal-to-noise
    or a technique. Linear: only the first MAX_SCAN_CHARS characters are read, so a longer
    header never has a unit suffix.
    """
    group = _trailing_group(header)
    if group is None:
        return None
    inner = group[1]
    if _is_metadata_group(inner):
        return None
    if parse_unit(inner) is None and "/" not in inner:
        return None
    return group


def _polymer_label(header: str) -> str:
    """The header without a trailing unit or technique group ("PET (µg/mL)" -> "PET",
    "PET (Py-GC/MS)" -> "PET")."""
    suffix = _unit_suffix(header)
    if suffix:
        return suffix[0]
    group = _trailing_group(header)
    if group and parse_technique(group[1]) is not None:
        return group[0]
    return header


def _header_unit(header: str) -> str | None:
    suffix = _unit_suffix(header)
    return suffix[1].strip() if suffix else None


def _is_polymer_header(header: str) -> bool:
    if len(header) > MAX_SCAN_CHARS:  # a polymer label is never that long
        return False
    return normalize_polymer(_polymer_label(header)) not in (UNKNOWN, OTHER)


def _field_of(header: str) -> str | None:
    return None if len(header) > MAX_SCAN_CHARS else _LOOKUP.get(_norm(header))


def _common_header_unit(columns: list[str]) -> str | None:
    """The unit code shared by every polymer header, or None if one lacks it or they differ."""
    units = {parse_unit(_header_unit(c) or "") for c in columns}
    if len(units) != 1:
        return None
    unit = units.pop()
    return unit.code if unit is not None else None


def suggest_mapping(table: RawTable) -> Mapping:
    """Columns recognised by their header; wide format when >= 2 headers are polymers.

    In wide format, when every polymer header carries the same known unit ("PET (ng/mL)")
    and no column is mapped to ``unit``, that unit is proposed as the ``unit`` constant.
    Headers longer than MAX_SCAN_CHARS are never recognised.
    """
    field_columns: dict[str, str] = {}
    for col in table.columns:
        target = _field_of(col)
        if target and target not in field_columns:
            field_columns[target] = col
    if "sample_id" not in field_columns:
        for col in table.columns:
            if len(col) <= MAX_SCAN_CHARS and _norm(col) == _GENERIC_ID:
                field_columns["sample_id"] = col
                break
    if "polymer" not in field_columns:
        used = set(field_columns.values())
        polymer_cols = [c for c in table.columns if c not in used and _is_polymer_header(c)]
        if len(polymer_cols) >= 2:
            constants: dict[str, str] = {}
            unit = _common_header_unit(polymer_cols)
            if unit is not None and "unit" not in field_columns:
                constants["unit"] = unit
            return Mapping("wide", field_columns, {c: _polymer_label(c) for c in polymer_cols},
                           constants)
    return Mapping("long", field_columns)


_SUFFIX = re.compile(r"^(.*\d)[-_]?([A-Za-z])$")  # a digit must precede the letter
_MAX_EXAMPLES = 5


def _check_mapping(table: RawTable, mapping: Mapping) -> list[Issue]:
    """Mapping errors; ``column`` is set only for columns that exist in the file (and never
    for a header longer than MAX_SCAN_CHARS, which is named by position, never echoed)."""
    issues: list[Issue] = []
    known = set(table.columns)
    positions = {col: k for k, col in enumerate(table.columns, 1)}

    def present(col: str | None) -> str | None:
        return col if col in known and len(col) <= MAX_SCAN_CHARS else None

    def named(col: str) -> str:
        if col in positions:
            return f"colonne n° {positions[col]}" if len(col) > MAX_SCAN_CHARS else f"colonne « {col} »"
        return "colonne inconnue" if len(col) > MAX_SCAN_CHARS else f"colonne « {col} »"

    def shown(name: str) -> str:
        return "(nom trop long)" if len(name) > MAX_SCAN_CHARS else name

    for name, col in mapping.field_columns.items():
        if name not in FIELD_NAMES:
            issues.append(issue("E_MAPPING_UNKNOWN_FIELD",
                                f"Champ standard inconnu : « {shown(name)} ».",
                                column=present(col)))
        if col not in known:
            issues.append(issue(
                "E_MAPPING_UNKNOWN_COLUMN",
                f"La {named(col)} associée à « {shown(name)} » est absente du tableau.",
                field=name if name in FIELD_NAMES else None))
    for col in mapping.polymer_columns:
        if col not in known:
            issues.append(issue("E_MAPPING_UNKNOWN_COLUMN",
                                f"La {named(col)} de polymère est absente du tableau.",
                                field="reported_value"))
    for name in mapping.constants:
        if name not in FIELD_NAMES:
            issues.append(issue("E_MAPPING_UNKNOWN_FIELD",
                                f"Champ standard inconnu : « {shown(name)} »."))
        if name in mapping.field_columns:
            issues.append(issue(
                "E_MAPPING_CONFLICT",
                f"Le champ « {shown(name)} » est associé à la fois à une colonne et à une constante.",
                column=present(mapping.field_columns[name]), field=name))
    if mapping.mode == "wide":
        for name in ("reported_value", "polymer"):
            if name in mapping.field_columns or name in mapping.constants:
                issues.append(issue(
                    "E_MAPPING_CONFLICT",
                    f"En format large, « {shown(name)} » provient des colonnes de polymères "
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
                  f"La {header_label(col, k)} n'est associée à aucun champ : elle est ignorée.",
                  column=None if len(col) > MAX_SCAN_CHARS else col)
            for k, col in enumerate(table.columns, 1) if col not in used]


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
    header_units = {col: _header_unit(col) for col in mapping.polymer_columns}
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
                                     {**columns, "polymer": col, "reported_value": col},
                                     header_units[col]))
    if failed:
        issues.append(_split_failed(list(failed), columns["sample_id"]))
    return out, issues
