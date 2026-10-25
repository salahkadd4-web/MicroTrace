"""Cross-import consistency: a new import checked against keys already recorded in the study.

The key and issue rules are B1's (``record_key``, ``issue``, ``E_DUPLICATE_RECORD``,
``E_SAMPLE_CONFLICT``); only the comparison against existing keys is new.
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence

from microtrace_core.results import MeasurementRecord
from microtrace_core.results.issues import Issue, issue
from microtrace_core.results.validation import record_key
from microtrace_core.results.vocab import Matrix, RecordType, fold

from microtrace_engine.schemas import ExistingKeyModel


def _detail(text: str) -> str:
    return " ".join(fold(text).split())


def _existing_key(e: ExistingKeyModel) -> tuple:
    return record_key(e.sample_id, e.aliquot, RecordType(e.record_type), e.polymer,
                      e.polymer_raw or e.polymer, e.method)


def cross_import_issues(
    records: Iterable[MeasurementRecord], existing: Sequence[ExistingKeyModel],
) -> list[Issue]:
    """Errors for records duplicating an existing measurement or contradicting a known sample."""
    if not existing:
        return []
    keys = {_existing_key(e) for e in existing}
    by_sample: dict[str, list[ExistingKeyModel]] = {}
    for e in existing:
        by_sample.setdefault(e.sample_id, []).append(e)

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
                row=r.source_row, field="sample_id"))
        if r.sample_id in conflicted or r.sample_id not in by_sample:
            continue
        parts: list[str] = []
        known = by_sample[r.sample_id]
        matrices = sorted({e.matrix for e in known if e.matrix != r.matrix.value})
        if matrices:
            parts.append(f"matrice {r.matrix.value} au lieu de {', '.join(matrices)}")
        elif r.matrix is Matrix.other and any(
                e.matrix == "other" and _detail(e.matrix_detail) != _detail(r.matrix_detail)
                for e in known):
            parts.append("détail de matrice « other » différent")
        types = sorted({e.record_type for e in known if e.record_type != r.record_type.value})
        if types:
            parts.append(f"type d'enregistrement {r.record_type.value} au lieu de "
                         f"{', '.join(types)}")
        if parts:
            conflicted.add(r.sample_id)
            out.append(issue(
                "E_SAMPLE_CONFLICT",
                f"Échantillon « {r.sample_id} » déjà enregistré dans l'étude avec une autre "
                f"définition : {' et '.join(parts)}. Un échantillon a une seule matrice et "
                "un seul type.",
                row=r.source_row, field="sample_id"))
    return out
