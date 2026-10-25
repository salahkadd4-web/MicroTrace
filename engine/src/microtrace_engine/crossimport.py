"""Cross-import consistency: a new import checked against keys already recorded in the study.

The key, sample and issue rules are B1's (``record_key``, ``sample_signature``, ``issue``,
``E_DUPLICATE_RECORD``, ``E_SAMPLE_CONFLICT``); only the comparison against existing keys
is new.
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence

from microtrace_core.results import MeasurementRecord
from microtrace_core.results.issues import Issue, issue
from microtrace_core.results.validation import record_key, sample_signature
from microtrace_core.results.vocab import Matrix, RecordType, label_fr

from microtrace_engine.schemas import ExistingKeyModel


def _existing_key(e: ExistingKeyModel) -> tuple:
    return record_key(e.sample_id, e.aliquot, RecordType(e.record_type), e.polymer,
                      e.polymer_raw or e.polymer, e.method)


def _labels(group: str, codes: Iterable[str]) -> str:
    return ", ".join(sorted({label_fr(group, c) for c in codes}))


def cross_import_issues(
    records: Iterable[MeasurementRecord], existing: Sequence[ExistingKeyModel],
    column: str | None = None,
) -> list[Issue]:
    """Errors for records duplicating an existing measurement or contradicting a known sample.

    ``column`` is the file column mapped to ``sample_id`` (None when unknown or masked).
    """
    if not existing:
        return []
    keys = {_existing_key(e) for e in existing}
    by_sample: dict[str, list[tuple[ExistingKeyModel, tuple]]] = {}
    for e in existing:
        by_sample.setdefault(e.sample_id, []).append((e, sample_signature(e)))

    out: list[Issue] = []
    conflicted: set[str] = set()
    for r in records:
        key = record_key(r.sample_id, r.aliquot, r.record_type, r.polymer, r.polymer_raw,
                         r.method)
        if key in keys:
            out.append(issue(
                "E_DUPLICATE_RECORD",
                f"Enregistrement déjà enregistré dans un import actif de l'étude "
                f"(échantillon {r.sample_id}, aliquote « {r.aliquot} », polymère "
                f"{r.polymer}, méthode {r.method}).",
                row=r.source_row, column=column, field="sample_id"))
        if r.sample_id in conflicted or r.sample_id not in by_sample:
            continue
        matrix, detail, rtype = sample_signature(r)
        known = [(e, s) for e, s in by_sample[r.sample_id] if s != (matrix, detail, rtype)]
        if not known:
            continue
        parts: list[str] = []
        matrices = {s[0] for _, s in known if s[0] is not matrix}
        if matrices:
            parts.append(f"matrice {label_fr('matrix', matrix)} au lieu de "
                         f"{_labels('matrix', matrices)}")
        elif matrix is Matrix.other and any(s[1] != detail for _, s in known):
            others = sorted({" ".join(e.matrix_detail.split()) for e, s in known
                             if s[1] != detail})
            parts.append(f"détail de matrice « autre » « {' '.join(r.matrix_detail.split())} » "
                         f"différent de « {', '.join(others)} »")
        types = {s[2] for _, s in known if s[2] is not rtype}
        if types:
            parts.append(f"type d'enregistrement {label_fr('record_type', rtype)} au lieu de "
                         f"{_labels('record_type', types)}")
        conflicted.add(r.sample_id)
        out.append(issue(
            "E_SAMPLE_CONFLICT",
            f"Échantillon « {r.sample_id} » déjà enregistré dans l'étude avec une autre "
            f"définition : {' et '.join(parts)}. Un échantillon a une seule matrice et "
            "un seul type.",
            row=r.source_row, column=column, field="sample_id"))
    return out
