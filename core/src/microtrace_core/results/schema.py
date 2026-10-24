"""Standard result-table schema and data dictionary export."""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from enum import StrEnum

from microtrace_core.results.units import UNITS
from microtrace_core.results.vocab import (
    DetectionStatus,
    IdentificationStatus,
    Matrix,
    RecordType,
)


@dataclass(frozen=True)
class FieldSpec:
    name: str
    label_fr: str
    type: str  # "text" | "number" | "date" | "enum"
    required: bool
    description_fr: str
    allowed: tuple[str, ...] = ()


def _values(enum: type[StrEnum]) -> tuple[str, ...]:
    return tuple(m.value for m in enum)


STANDARD_FIELDS: tuple[FieldSpec, ...] = (
    FieldSpec("sample_id", "Identifiant d'échantillon", "text", True,
              "Identifiant de l'échantillon, conservé tel quel (zéros initiaux compris)."),
    FieldSpec("matrix", "Matrice", "enum", True,
              "Matrice biologique analysée.", _values(Matrix)),
    FieldSpec("polymer", "Polymère", "text", True,
              "Polymère mesuré (nom ou abréviation, ex. PE, PET, PS)."),
    FieldSpec("reported_value", "Valeur rapportée", "text", True,
              "Valeur telle que rapportée par le laboratoire, y compris les valeurs censurées "
              "(ex. <LOD, n.d., < 0,68)."),
    FieldSpec("unit", "Unité", "enum", True,
              "Unité de la valeur rapportée ; fixe la grandeur (masse ou nombre) et la base.",
              tuple(UNITS)),
    FieldSpec("method", "Méthode", "text", True,
              "Méthode analytique (ex. Py-GC/MS, µFTIR), déclarée dans le contexte de l'étude."),
    FieldSpec("aliquot", "Aliquote", "text", False,
              "Identifiant de l'aliquote ou de la réplique analytique."),
    FieldSpec("record_type", "Type d'enregistrement", "enum", False,
              "Nature de l'échantillon : échantillon, blanc procédural, blanc de terrain "
              "ou échantillon dopé.", _values(RecordType)),
    FieldSpec("matrix_detail", "Détail de la matrice", "text", False,
              "Précision libre sur la matrice (anticoagulant, prétraitement, etc.)."),
    FieldSpec("lod", "Limite de détection", "number", False,
              "Limite de détection (LOD), dans l'unité de la valeur rapportée."),
    FieldSpec("loq", "Limite de quantification", "number", False,
              "Limite de quantification (LOQ), dans l'unité de la valeur rapportée."),
    FieldSpec("detection_status", "Statut de détection", "enum", False,
              "Statut déclaré ; à défaut, déduit de la valeur rapportée et des limites.",
              _values(DetectionStatus)),
    FieldSpec("identification_status", "Statut d'identification", "enum", False,
              "Identification confirmée par la technique ou simple candidat ; "
              "à défaut, déduit de la méthode.", _values(IdentificationStatus)),
    FieldSpec("size_min_um", "Taille minimale (µm)", "number", False,
              "Borne inférieure de la gamme de tailles détectée, en micromètres."),
    FieldSpec("size_max_um", "Taille maximale (µm)", "number", False,
              "Borne supérieure de la gamme de tailles détectée, en micromètres."),
    FieldSpec("analysis_date", "Date d'analyse", "date", False,
              "Date de l'analyse, au format AAAA-MM-JJ."),
    FieldSpec("batch", "Lot", "text", False,
              "Lot ou série analytique, utile pour rattacher les blancs."),
    FieldSpec("lab", "Laboratoire", "text", False,
              "Laboratoire ayant produit la mesure."),
    FieldSpec("comment", "Commentaire", "text", False,
              "Remarque libre."),
)

REQUIRED_FIELDS: frozenset[str] = frozenset(f.name for f in STANDARD_FIELDS if f.required)
FIELD_NAMES: tuple[str, ...] = tuple(f.name for f in STANDARD_FIELDS)

_COLUMNS = ("name", "label_fr", "type", "required", "description_fr", "allowed")


def data_dictionary_csv() -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(_COLUMNS)
    for f in STANDARD_FIELDS:
        writer.writerow([f.name, f.label_fr, f.type, "yes" if f.required else "no",
                         f.description_fr, "|".join(f.allowed)])
    return buf.getvalue()


def _cell(text: str) -> str:
    return text.replace("|", "\\|")


def data_dictionary_markdown() -> str:
    lines = [
        "# Dictionnaire de données — MicroTrace Studio",
        "",
        "| Champ | Libellé | Type | Obligatoire | Description | Valeurs admises |",
        "|---|---|---|---|---|---|",
    ]
    for f in STANDARD_FIELDS:
        allowed = ", ".join(f"`{a}`" for a in f.allowed)
        lines.append(
            f"| `{f.name}` | {_cell(f.label_fr)} | {f.type} | {'oui' if f.required else 'non'} "
            f"| {_cell(f.description_fr)} | {_cell(allowed)} |"
        )
    return "\n".join(lines) + "\n"
