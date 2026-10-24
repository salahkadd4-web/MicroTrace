"""Row validation: mapped rows -> measurement records plus located French issues.

Scientific rules: no silent correction, no imputation. A row with at least one
error yields no record. Issue ``field`` is the standard field concerned and
``column`` its file column (``MappedRow.columns``; the polymer column in wide
format); ``column`` is None when the value comes from a constant or from the
study context (limits table).
"""
from __future__ import annotations

import math

from microtrace_core.polymers import OTHER, UNKNOWN, normalize_polymer
from microtrace_core.results.censoring import (
    infer_status,
    parse_declared_status,
    parse_reported_value,
)
from microtrace_core.results.issues import ISSUE_CODES, Issue, issue
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
    normalize_result_polymer,
    parse_matrix,
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


def _validate_row(  # noqa: C901 - linear rule list, kept in one place on purpose
    row: MappedRow, ctx: StudyContext, seen: set[tuple], issues: list[Issue],
) -> MeasurementRecord | None:
    n = row.source_row
    f = {k: (v or "").strip(" \xa0\t\r\n") for k, v in row.fields.items()}
    cols = dict(row.columns)
    if "reported_value" not in cols and row.source_column:
        cols["reported_value"] = row.source_column
    errors = 0

    def add(code: str, msg: str, name: str, column: object = _FROM_ROW) -> None:
        """Record an issue on field ``name``; ``column=None`` for study-context problems."""
        nonlocal errors
        if ISSUE_CODES[code] == "error":
            errors += 1
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
    if f.get("method"):
        spec = next((m for m in ctx.methods if m.name == f["method"]), None)
        if spec is None:
            add("E_UNKNOWN_METHOD",
                f"Méthode « {f['method']} » absente du contexte de l'étude.", "method")
    technique: Technique | None = spec.technique if spec else None

    # record type / identification / declared status
    record_type = RecordType.sample
    if f.get("record_type"):
        rt = _enum_lookup(RecordType, f["record_type"])
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
        for dl in ctx.limits:
            if dl.method != f["method"]:
                continue
            if normalize_result_polymer(dl.polymer, tech_for_poly) != polymer:
                continue
            dl_unit = parse_unit(dl.unit_code)
            if dl_unit is None:
                add("E_LIMIT_UNIT_MISMATCH",
                    f"Limite de l'étude : unité inconnue « {dl.unit_code} » "
                    f"(méthode {dl.method}, polymère {polymer}).", "lod", None)
                unit_err = True
                continue
            try:
                conv = {name: (convert(val, dl_unit, unit) if val is not None else None)
                        for name, val in (("lod", dl.lod), ("loq", dl.loq))}
            except UnitMismatchError:
                add("E_LIMIT_UNIT_MISMATCH",
                    f"Limite de l'étude en « {dl.unit_code} » incompatible avec l'unité "
                    f"« {unit.code} » de la mesure (méthode {dl.method}, polymère {polymer}).",
                    "lod", None)
                unit_err = True
                continue
            for name in ("lod", "loq"):
                if conv[name] is not None and conv[name] < 0:
                    add("E_NEGATIVE_VALUE",
                        f"{name.upper()} de l'étude négative : {conv[name]:g}.", name, None)
            if (conv["lod"] is not None and conv["loq"] is not None
                    and conv["lod"] > conv["loq"] and not gt_flagged):
                gt_flagged = True
                add("E_LOD_GT_LOQ",
                    f"LOD de l'étude ({conv['lod']:g}) supérieure à la LOQ "
                    f"({conv['loq']:g}).", "lod", None)
            if first:
                tab_lim = conv
                first = False
            else:
                for name in ("lod", "loq"):
                    a_, b_ = tab_lim[name], conv[name]
                    if a_ is not None and b_ is not None and not _same(a_, b_):
                        add("W_LIMIT_CONFLICT",
                            f"Plusieurs {name.upper()} différentes dans l'étude pour "
                            f"{dl.method}/{polymer} ({a_:g} et {b_:g}) : la première "
                            "entrée est conservée.", name, None)
    lim: dict[str, float | None] = {}
    for name in ("lod", "loq"):
        rv, tv = row_lim[name], tab_lim[name]
        if rv is not None and tv is not None and not _same(rv, tv):
            add("W_LIMIT_CONFLICT",
                f"{name.upper()} de la ligne ({rv:g}) différente de celle de l'étude "
                f"({tv:g}) : celle de la ligne est utilisée.", name)
        lim[name] = rv if rv is not None else tv
    lod, loq = lim["lod"], lim["loq"]
    if lod is not None and loq is not None and lod > loq and not gt_flagged:
        add("E_LOD_GT_LOQ", f"LOD ({lod:g}) supérieure à la LOQ ({loq:g}).", "lod",
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
                    f"Borne « {reported_text} » supérieure à la LOQ ({loq:g}) : "
                    "statut non quantifié conservé.", "reported_value")
        else:  # plain number
            if inferred is DetectionStatus.below_lod:
                status = inferred
                add("W_VALUE_BELOW_LOD",
                    f"Valeur « {reported_text} » inférieure à la LOD ({lod:g}) : "
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

    # duplicates (flagged on the second occurrence)
    if f.get("sample_id") and polymer and f.get("method"):
        poly_key = polymer if polymer != OTHER else "OTHER:" + " ".join(fold(f["polymer"]).split())
        key = (f["sample_id"], f.get("aliquot", ""), record_type, poly_key, f["method"])
        if key in seen:
            add("E_DUPLICATE_RECORD",
                f"Enregistrement en double (échantillon {f['sample_id']}, aliquote "
                f"« {f.get('aliquot', '')} », polymère {polymer}, méthode {f['method']}).",
                "sample_id")
        seen.add(key)

    if (errors or matrix is None or technique is None or unit is None
            or status is None or ident is None):
        return None
    if value is not None:
        canonical_value, canonical_unit = to_canonical(value, unit)
    else:
        canonical_value, canonical_unit = None, canonical_unit_of(unit.kind, unit.basis)
    return MeasurementRecord(
        sample_id=f["sample_id"], aliquot=f.get("aliquot", ""), record_type=record_type,
        matrix=matrix, matrix_detail=f.get("matrix_detail", ""), polymer=polymer,
        polymer_raw=f["polymer"], method=f["method"], technique=technique,
        reported_value=reported_text, value=value, unit=unit,
        canonical_value=canonical_value, canonical_unit=canonical_unit, status=status,
        lod=lod, loq=loq, identification_status=ident,
        size_min_um=sizes["size_min_um"], size_max_um=sizes["size_max_um"],
        analysis_date=f.get("analysis_date", ""), batch=f.get("batch", ""),
        lab=f.get("lab", ""), comment=f.get("comment", ""),
        source_row=n, source_column=row.source_column,
    )


def validate_rows(
    rows: list[MappedRow], context: StudyContext,
) -> tuple[list[MeasurementRecord], list[Issue]]:
    issues: list[Issue] = []
    records: list[MeasurementRecord] = []
    seen: set[tuple] = set()
    sample_column: str | None = None
    for row in rows:
        rec = _validate_row(row, context, seen, issues)
        if rec is not None:
            records.append(rec)
            sample_column = sample_column or row.columns.get("sample_id")
    issues.extend(_sample_conflicts(records, sample_column))
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
