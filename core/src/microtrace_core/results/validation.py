"""Row validation: mapped rows -> measurement records plus located French issues.

Scientific rules: no silent correction, no imputation. A row with at least one
error yields no record. Issue ``field`` is the standard field concerned and
``column`` its file column (``MappedRow.columns``; the polymer column in wide
format); ``column`` is None when the value comes from a constant or from the
study context (limits table).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import date

from microtrace_core.polymers import OTHER, UNKNOWN, normalize_polymer
from microtrace_core.results.censoring import (
    infer_status,
    parse_declared_status,
    parse_reported_value,
)
from microtrace_core.results.issues import ISSUE_CODES, Issue, fmt_fr, issue
from microtrace_core.results.mapping import MappedRow
from microtrace_core.results.records import MeasurementRecord, StudyContext
from microtrace_core.results.units import (
    Unit,
    UnitMismatchError,
    canonical_unit as canonical_unit_of,
    convert,
    parse_unit,
    to_canonical,
)
from microtrace_core.results.vocab import (
    PS_SUM,
    DetectionStatus,
    IdentificationStatus,
    Matrix,
    RecordType,
    Technique,
    default_identification,
    fold,
    method_key,
    normalize_result_polymer,
    parse_matrix,
    parse_record_type,
)

_REQUIRED = ("sample_id", "matrix", "polymer", "unit", "method")
_FROM_ROW = object()  # sentinel: the issue's column is the row's file column for its field
_NO_VALUE = (
    DetectionStatus.below_lod, DetectionStatus.not_quantified, DetectionStatus.not_analysed,
)


def _enum_lookup(enum, text: str):
    key = "_".join(fold(text).replace("-", " ").split())
    for member in enum:
        if member.value == key:
            return member
    return None


def _plain_number(text: str) -> float | None:
    r = parse_reported_value(text)
    if r.ok and r.value is not None and r.hint is None:
        return r.value
    return None


def _missing(lod: float | None, loq: float | None) -> str:
    if lod is None and loq is None:
        return "LOD et LOQ absentes"
    return "LOQ absente" if loq is None else "LOD absente"


def _same(a: float, b: float) -> bool:
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-12)


_ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$")
_DAY_FIRST = re.compile(r"^(\d{1,2})([/.\-])(\d{1,2})\2(\d{4})$")


def _parse_date(text: str) -> tuple[str | None, bool]:
    """(ISO text or None if invalid, normalised from day-first DD/MM/YYYY)."""
    if m := _ISO_DATE.match(text):
        y, mo, d, h, mi, se = m.groups()
        if h is not None and (int(h) > 23 or int(mi) > 59 or int(se or 0) > 59):
            return None, False
        iso, normalized = text, False
    elif m := _DAY_FIRST.match(text):
        d, _, mo, y = m.groups()
        iso, normalized = f"{int(y):04d}-{int(mo):02d}-{int(d):02d}", True
    else:
        return None, False
    try:
        date(int(y), int(mo), int(d))
    except ValueError:
        return None, False
    return iso, normalized


@dataclass
class _State:
    """What one validate_rows call accumulates across rows."""

    seen: set[tuple] = field(default_factory=set)  # duplicate keys
    reported: set[tuple] = field(default_factory=set)  # study-limit problems already reported
    empty: dict[str | None, int] = field(default_factory=dict)  # value column -> empty cells
    dates: dict[str | None, set[int]] = field(default_factory=dict)  # column -> rows normalised


def _validate_row(  # noqa: C901 - linear rule list, kept in one place on purpose
    row: MappedRow, ctx: StudyContext, state: _State, issues: list[Issue],
) -> MeasurementRecord | None:
    n = row.source_row
    f = {k: (v or "").strip(" \xa0\t\r\n") for k, v in row.fields.items()}
    cols = dict(row.columns)
    if "reported_value" not in cols and row.source_column:
        cols["reported_value"] = row.source_column
    errors = 0

    def add(code: str, msg: str, name: str, column: object = _FROM_ROW,
            once: tuple | None = None) -> None:
        """Record an issue on field ``name``; ``column=None`` for study-context problems.
        With ``once``, the issue is reported for the first row only (still blocks each row)."""
        nonlocal errors
        if ISSUE_CODES[code] == "error":
            errors += 1
        if once is not None:
            if once in state.reported:
                return
            state.reported.add(once)
        col = cols.get(name) if column is _FROM_ROW else column
        issues.append(issue(code, msg, n, col, name))  # type: ignore[arg-type]

    for name in _REQUIRED:
        if not f.get(name):
            add("E_REQUIRED_MISSING", f"Champ obligatoire vide : {name}.", name)

    # matrix
    matrix = None
    if f.get("matrix"):
        matrix = parse_matrix(f["matrix"])
        if matrix is None:
            add("E_UNKNOWN_MATRIX", f"Matrice inconnue : « {f['matrix']} ».", "matrix")
        elif matrix is Matrix.other and not f.get("matrix_detail"):
            add("E_MATRIX_DETAIL_MISSING",
                "Matrice « autre » : le détail de la matrice est obligatoire.", "matrix_detail")

    # method
    spec = None
    mkey = method_key(f.get("method", ""))
    if f.get("method"):
        spec = next((m for m in ctx.methods if method_key(m.name) == mkey), None)
        if spec is None:
            add("E_UNKNOWN_METHOD",
                f"Méthode « {f['method']} » absente du contexte de l'étude.", "method")
    technique: Technique | None = spec.technique if spec else None

    # record type / identification / declared status
    record_type = RecordType.sample
    if f.get("record_type"):
        rt = parse_record_type(f["record_type"])
        if rt is None:
            add("E_UNKNOWN_RECORD_TYPE",
                f"Type d'enregistrement inconnu : « {f['record_type']} ».", "record_type")
        else:
            record_type = rt
    ident: IdentificationStatus | None = None
    if f.get("identification_status"):
        ident = _enum_lookup(IdentificationStatus, f["identification_status"])
        if ident is None:
            add("E_UNKNOWN_IDENTIFICATION",
                f"Statut d'identification inconnu : « {f['identification_status']} ».",
                "identification_status")
    elif technique is not None:
        ident = default_identification(technique)
    declared: DetectionStatus | None = None
    if f.get("detection_status"):
        declared = parse_declared_status(f["detection_status"])
        if declared is None:
            add("E_UNKNOWN_STATUS",
                f"Statut de détection inconnu : « {f['detection_status']} ».", "detection_status")

    # polymer
    polymer = ""
    tech_for_poly = technique or Technique.other
    if f.get("polymer"):
        polymer = normalize_result_polymer(f["polymer"], tech_for_poly)
        if polymer == UNKNOWN:
            add("E_POLYMER_MISSING",
                f"Polymère non renseigné ou illisible : « {f['polymer']} ».", "polymer")
        elif polymer == OTHER:
            add("W_POLYMER_OTHER",
                f"Polymère « {f['polymer']} » non reconnu : conservé comme OTHER.", "polymer")
        elif polymer == PS_SUM and normalize_polymer(f["polymer"]) == "PS":
            add("I_PS_AS_SUM",
                "PS issu d'une technique thermoanalytique : enregistré comme PS_SUM "
                "(somme PS, sans distinction de la forme).", "polymer")

    # unit
    unit: Unit | None = None
    if f.get("unit"):
        unit = parse_unit(f["unit"])
        if unit is None:
            add("E_UNKNOWN_UNIT", f"Unité inconnue : « {f['unit']} ».", "unit")

    # reported value
    reported_text = f.get("reported_value", "")
    if not reported_text:  # kept as not_analysed, but counted per column (I_EMPTY_AS_NOT_ANALYSED)
        vcol = cols.get("reported_value")
        state.empty[vcol] = state.empty.get(vcol, 0) + 1
    r = parse_reported_value(reported_text)
    value_ok = r.ok
    if not r.ok:
        add("E_UNPARSABLE_VALUE", f"Valeur illisible : « {reported_text} ».", "reported_value")
    elif (r.value is not None and r.value < 0) or (r.bound is not None and r.bound < 0):
        value_ok = False
        add("E_NEGATIVE_VALUE", f"Valeur négative : « {reported_text} ».", "reported_value")

    # sizes
    sizes: dict[str, float | None] = {}
    for name in ("size_min_um", "size_max_um"):
        sizes[name] = None
        if f.get(name):
            sizes[name] = _plain_number(f[name])
            if sizes[name] is None:
                add("E_UNPARSABLE_VALUE", f"Taille illisible : « {f[name]} ».", name)
            elif sizes[name] < 0:
                add("E_NEGATIVE_VALUE", f"Taille négative : « {f[name]} ».", name)

    # analysis date: ISO kept, day-first normalised (counted per column), anything else refused
    analysis_date = f.get("analysis_date", "")
    if analysis_date:
        iso, normalized = _parse_date(analysis_date)
        if iso is None:
            add("E_INVALID_DATE",
                f"Date d'analyse invalide : « {analysis_date} » (formats acceptés : AAAA-MM-JJ, "
                "AAAA-MM-JJTHH:MM[:SS] ou JJ/MM/AAAA).", "analysis_date")
        else:
            if normalized:
                state.dates.setdefault(cols.get("analysis_date"), set()).add(n)
            analysis_date = iso

    # limits: row columns first, otherwise the study table (converted to the row unit)
    row_lim: dict[str, float | None] = {"lod": None, "loq": None}
    for name in ("lod", "loq"):
        if f.get(name):
            v = _plain_number(f[name])
            if v is None:
                add("E_UNPARSABLE_VALUE", f"{name.upper()} illisible : « {f[name]} ».", name)
            elif v < 0:
                add("E_NEGATIVE_VALUE", f"{name.upper()} négative : « {f[name]} ».", name)
            else:
                row_lim[name] = v
    tab_lim: dict[str, float | None] = {"lod": None, "loq": None}
    gt_flagged = False
    unit_err = False
    if unit is not None and polymer and polymer != UNKNOWN and f.get("method"):
        first = True
        # a broken study entry is a context problem: reported once per entry (``once``),
        # attributed to the first row it concerns, yet it still blocks every such row
        for i, dl in enumerate(ctx.limits):
            if method_key(dl.method) != mkey:
                continue
            if normalize_result_polymer(dl.polymer, tech_for_poly) != polymer:
                continue
            where = f"méthode {dl.method}, polymère {polymer}"
            dl_unit = parse_unit(dl.unit_code)
            if dl_unit is None:
                add("E_LIMIT_UNIT_MISMATCH",
                    f"Limite de l'étude : unité inconnue « {dl.unit_code} » ({where}).",
                    "lod", None, once=(i, "unit"))
                unit_err = True
                continue
            try:
                conv = {name: (convert(val, dl_unit, unit) if val is not None else None)
                        for name, val in (("lod", dl.lod), ("loq", dl.loq))}
            except UnitMismatchError:
                add("E_LIMIT_UNIT_MISMATCH",
                    f"Limite de l'étude en « {dl.unit_code} » incompatible avec l'unité "
                    f"« {unit.code} » de la mesure ({where}).",
                    "lod", None, once=(i, "mismatch", unit.code))
                unit_err = True
                continue
            raw = {"lod": dl.lod, "loq": dl.loq}
            for name in ("lod", "loq"):
                if raw[name] is not None and raw[name] < 0:
                    add("E_NEGATIVE_VALUE",
                        f"{name.upper()} de l'étude négative : {fmt_fr(raw[name])} "
                        f"{dl.unit_code} ({where}).", name, None, once=(i, "negative", name))
            if (raw["lod"] is not None and raw["loq"] is not None
                    and raw["lod"] > raw["loq"] and not gt_flagged):
                gt_flagged = True
                add("E_LOD_GT_LOQ",
                    f"LOD de l'étude ({fmt_fr(raw['lod'])} {dl.unit_code}) supérieure à la LOQ "
                    f"({fmt_fr(raw['loq'])} {dl.unit_code}) ({where}).", "lod", None,
                    once=(i, "lod_gt_loq"))
            if first:
                tab_lim = conv
                first = False
            else:
                for name in ("lod", "loq"):
                    a_, b_ = tab_lim[name], conv[name]
                    if a_ is not None and b_ is not None and not _same(a_, b_):
                        add("W_LIMIT_CONFLICT",
                            f"Plusieurs {name.upper()} différentes dans l'étude pour "
                            f"{dl.method}/{polymer} ({fmt_fr(a_)} et {fmt_fr(b_)} "
                            f"{unit.code}) : la première entrée est conservée.", name, None,
                            once=(i, "conflict", name, unit.code))
    lim: dict[str, float | None] = {}
    for name in ("lod", "loq"):
        rv, tv = row_lim[name], tab_lim[name]
        if rv is not None and tv is not None and not _same(rv, tv):
            add("W_LIMIT_CONFLICT",
                f"{name.upper()} de la ligne ({fmt_fr(rv)}) différente de celle de l'étude "
                f"({fmt_fr(tv)}) : celle de la ligne est utilisée.", name)
        lim[name] = rv if rv is not None else tv
    lod, loq = lim["lod"], lim["loq"]
    if lod is not None and loq is not None and lod > loq and not gt_flagged:
        add("E_LOD_GT_LOQ", f"LOD ({fmt_fr(lod)}) supérieure à la LOQ ({fmt_fr(loq)}).", "lod",
            cols.get("lod") if row_lim["lod"] is not None else None)

    # detection status (never changed by warnings)
    status: DetectionStatus | None = None
    value = r.value if value_ok else None
    if value_ok:
        inferred = infer_status(r, lod, loq)
        if declared is not None:
            status = declared
            if declared in _NO_VALUE and r.value is not None and r.hint is None:
                add("E_STATUS_VALUE_CONFLICT",
                    f"Statut déclaré « {declared.value} » incompatible avec la valeur "
                    f"numérique « {reported_text} ».", "reported_value")
            elif (declared in (DetectionStatus.quantified, DetectionStatus.between_lod_loq)
                    and r.value is None):
                add("E_STATUS_VALUE_CONFLICT",
                    f"Statut déclaré « {declared.value} » sans valeur numérique "
                    f"(valeur rapportée : « {reported_text} »).", "reported_value")
            elif (inferred is not None and inferred != declared
                    and not (lod is None and inferred is DetectionStatus.not_quantified
                             and declared in (DetectionStatus.between_lod_loq,
                                              DetectionStatus.below_lod))):
                add("W_STATUS_INCONSISTENT",
                    f"Statut déclaré « {declared.value} » différent du statut déduit "
                    f"« {inferred.value} » : le statut déclaré est conservé.", "reported_value")
        elif r.hint is DetectionStatus.not_analysed:
            status = r.hint  # empty cell or NA: not an error
        elif r.hint is DetectionStatus.between_lod_loq:
            status = r.hint
            if (lod is not None and r.value < lod) or (loq is not None and r.value >= loq):
                add("W_STATUS_INCONSISTENT",
                    f"Valeur « {reported_text} » marquée entre LOD et LOQ mais hors de "
                    "l'intervalle [LOD, LOQ).", "reported_value")
        elif r.hint is not None:
            status = r.hint
        elif r.bound is not None:
            status = inferred or DetectionStatus.not_quantified
            if inferred is None and not unit_err:
                add("W_NO_LIMITS",
                    f"{_missing(lod, loq)} pour « {reported_text} » : "
                    "statut non quantifié.", "reported_value")
            if loq is not None and r.bound > loq:
                add("W_STATUS_INCONSISTENT",
                    f"Borne « {reported_text} » supérieure à la LOQ ({fmt_fr(loq)}) : "
                    "statut non quantifié conservé.", "reported_value")
        else:  # plain number
            if inferred is DetectionStatus.below_lod:
                status = inferred
                add("W_VALUE_BELOW_LOD",
                    f"Valeur « {reported_text} » inférieure à la LOD ({fmt_fr(lod)}) : "
                    "statut sous la limite de détection, valeur non conservée.", "reported_value")
            elif inferred is not None:
                status = inferred
                if inferred is DetectionStatus.not_quantified and lod is None:
                    add("W_NO_LIMITS",
                        f"LOD absente : « {reported_text} » est sous la LOQ, statut non "
                        "quantifié, valeur non conservée.", "reported_value")
            elif unit_err:
                status = DetectionStatus.quantified
            else:
                status = DetectionStatus.quantified
                add("W_NO_LIMITS",
                    f"{_missing(lod, loq)} pour « {reported_text} » : "
                    "statut quantifié par défaut, sans vérification.", "reported_value")
        if status in _NO_VALUE:
            value = None

    # duplicates (flagged on the second occurrence; methods compared like method names)
    method = spec.name if spec else f.get("method", "")
    if f.get("sample_id") and polymer and f.get("method"):
        poly_key = polymer if polymer != OTHER else "OTHER:" + " ".join(fold(f["polymer"]).split())
        key = (f["sample_id"], f.get("aliquot", ""), record_type, poly_key, mkey)
        if key in state.seen:
            add("E_DUPLICATE_RECORD",
                f"Enregistrement en double (échantillon {f['sample_id']}, aliquote "
                f"« {f.get('aliquot', '')} », polymère {polymer}, méthode {method}).",
                "sample_id")
        state.seen.add(key)

    if (errors or matrix is None or technique is None or unit is None
            or status is None or ident is None):
        return None
    canonical_unit = canonical_unit_of(unit.kind, unit.basis)

    def canonical(v: float | None) -> float | None:
        return to_canonical(v, unit)[0] if v is not None else None
    return MeasurementRecord(
        sample_id=f["sample_id"], aliquot=f.get("aliquot", ""), record_type=record_type,
        matrix=matrix, matrix_detail=f.get("matrix_detail", ""), polymer=polymer,
        polymer_raw=f["polymer"], method=method, technique=technique,
        reported_value=reported_text, value=value, unit=unit,
        canonical_value=canonical(value), canonical_unit=canonical_unit, status=status,
        lod=lod, loq=loq, canonical_lod=canonical(lod), canonical_loq=canonical(loq),
        identification_status=ident,
        size_min_um=sizes["size_min_um"], size_max_um=sizes["size_max_um"],
        analysis_date=analysis_date, batch=f.get("batch", ""),
        lab=f.get("lab", ""), comment=f.get("comment", ""),
        source_row=n, source_column=row.source_column,
    )


def validate_rows(
    rows: list[MappedRow], context: StudyContext,
) -> tuple[list[MeasurementRecord], list[Issue]]:
    issues: list[Issue] = []
    records: list[MeasurementRecord] = []
    state = _State()
    sample_column: str | None = None
    for row in rows:
        rec = _validate_row(row, context, state, issues)
        if rec is not None:
            records.append(rec)
            sample_column = sample_column or row.columns.get("sample_id")
    issues.extend(_sample_conflicts(records, sample_column))
    for col, k in state.empty.items():
        where = f" de la colonne « {col} »" if col else ""
        issues.append(issue(
            "I_EMPTY_AS_NOT_ANALYSED",
            f"{k} cellule(s) de valeur vide(s){where} : enregistrée(s) comme non analysée(s) "
            "(not_analysed), sans valeur.", column=col, field="reported_value"))
    for col, numbers in state.dates.items():
        where = f" (colonne « {col} »)" if col else ""
        issues.append(issue(
            "I_DATE_NORMALIZED",
            f"{len(numbers)} ligne(s) avec une date d'analyse au format JJ/MM/AAAA{where} : "
            "convertie(s) au format AAAA-MM-JJ.", column=col, field="analysis_date"))
    return records, issues


def _sample_conflicts(records: list[MeasurementRecord], column: str | None) -> list[Issue]:
    """One error per sample carrying several matrices or record types in one import."""
    by_sample: dict[str, list[MeasurementRecord]] = {}
    for r in records:
        by_sample.setdefault(r.sample_id, []).append(r)
    out: list[Issue] = []
    for sid, recs in by_sample.items():
        parts = []
        matrices = sorted({r.matrix.value for r in recs})
        types = sorted({r.record_type.value for r in recs})
        if len(matrices) > 1:
            parts.append(f"plusieurs matrices ({', '.join(matrices)})")
        if len(types) > 1:
            parts.append(f"plusieurs types d'enregistrement ({', '.join(types)})")
        if parts:
            lines = ", ".join(str(n) for n in sorted({r.source_row for r in recs}))
            out.append(issue(
                "E_SAMPLE_CONFLICT",
                f"Échantillon « {sid} » : {' et '.join(parts)} dans un même import "
                f"(lignes {lines}). Un échantillon a une seule matrice et un seul type.",
                column=column, field="sample_id"))
    return out
