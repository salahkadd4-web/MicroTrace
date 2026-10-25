"""Controlled vocabularies for laboratory result tables."""
from __future__ import annotations

import unicodedata
from enum import StrEnum

from microtrace_core.polymers import normalize_polymer


class Matrix(StrEnum):
    whole_blood = "whole_blood"
    plasma = "plasma"
    serum = "serum"
    other = "other"


class Technique(StrEnum):
    py_gc_ms = "py_gc_ms"
    ted_gc_ms = "ted_gc_ms"
    micro_ftir = "micro_ftir"
    micro_raman = "micro_raman"
    other = "other"


class QuantityKind(StrEnum):
    mass_concentration = "mass_concentration"
    number_concentration = "number_concentration"


class Basis(StrEnum):
    per_volume = "per_volume"
    per_mass = "per_mass"


class DetectionStatus(StrEnum):
    quantified = "quantified"
    between_lod_loq = "between_lod_loq"
    not_quantified = "not_quantified"
    below_lod = "below_lod"
    not_analysed = "not_analysed"


class RecordType(StrEnum):
    sample = "sample"
    procedural_blank = "procedural_blank"
    field_blank = "field_blank"
    spiked = "spiked"


class IdentificationStatus(StrEnum):
    confirmed = "confirmed"
    candidate = "candidate"


class DataNature(StrEnum):
    published = "published"
    laboratory = "laboratory"
    simulated = "simulated"


PS_SUM = "PS_SUM"
ANY = "ANY"  # polymer code of the "any polymer" quantification frequency
THERMOANALYTICAL = frozenset({Technique.py_gc_ms, Technique.ted_gc_ms})

STATUS_RANK: dict[DetectionStatus, int] = {
    DetectionStatus.quantified: 4,
    DetectionStatus.between_lod_loq: 3,
    DetectionStatus.not_quantified: 2,
    DetectionStatus.below_lod: 1,
    DetectionStatus.not_analysed: 0,
}


def fold(text: str) -> str:
    """Lowercase, strip accents (NFKD, drop combining marks) and trim."""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return stripped.strip().lower()


_MATRIX_SYNONYMS: dict[str, Matrix] = {
    "whole blood": Matrix.whole_blood, "sang total": Matrix.whole_blood,
    "sang": Matrix.whole_blood, "blood": Matrix.whole_blood,
    "plasma": Matrix.plasma, "plasma sanguin": Matrix.plasma,
    "serum": Matrix.serum,
    "other": Matrix.other, "autre": Matrix.other,
}

_TECHNIQUE_SYNONYMS: dict[str, Technique] = {
    "py-gc/ms": Technique.py_gc_ms, "pyr-gc/ms": Technique.py_gc_ms,
    "py_gc_ms": Technique.py_gc_ms, "pyrolysis gc-ms": Technique.py_gc_ms,
    "ted-gc/ms": Technique.ted_gc_ms, "ted_gc_ms": Technique.ted_gc_ms,
    "uftir": Technique.micro_ftir, "micro-ftir": Technique.micro_ftir,
    "ftir": Technique.micro_ftir, "micro_ftir": Technique.micro_ftir,
    "uraman": Technique.micro_raman, "micro-raman": Technique.micro_raman,
    "raman": Technique.micro_raman, "micro_raman": Technique.micro_raman,
    "other": Technique.other, "autre": Technique.other,
}


def parse_matrix(text: str) -> Matrix | None:
    return _MATRIX_SYNONYMS.get(" ".join(fold(text).split()))


def parse_technique(text: str) -> Technique | None:
    key = " ".join(fold(text).split()).replace("µ", "u").replace("μ", "u")
    return _TECHNIQUE_SYNONYMS.get(key)


_PS_SUM_LABELS = frozenset({"ps_sum", "ps sum", "ps (sum)", "styrenics", "styreniques"})


def _fold_key(text: str) -> str:
    return " ".join(fold(text).split())


def normalize_result_polymer(label: str | None, technique: Technique) -> str:
    """Canonical polymer code; PS becomes PS_SUM for thermoanalytical techniques."""
    if label is not None and _fold_key(label) in _PS_SUM_LABELS:
        return PS_SUM
    code = normalize_polymer(label)
    if code == "PS" and technique in THERMOANALYTICAL:
        return PS_SUM
    return code


_RECORD_TYPE_SYNONYMS: dict[str, RecordType] = {
    **{m.value.replace("_", " "): m for m in RecordType},
    "echantillon": RecordType.sample,
    "blanc de procedure": RecordType.procedural_blank,
    "blanc procedure": RecordType.procedural_blank,
    "blanc de terrain": RecordType.field_blank, "blanc terrain": RecordType.field_blank,
    "dope": RecordType.spiked, "enrichi": RecordType.spiked, "spiked sample": RecordType.spiked,
}


def parse_record_type(text: str) -> RecordType | None:
    """Record type from its code or a French / English synonym ("blanc de terrain")."""
    key = " ".join(fold(text).replace("_", " ").replace("-", " ").split())
    return _RECORD_TYPE_SYNONYMS.get(key)


def method_key(name: str) -> str:
    """Method names match case- and whitespace-insensitively (" py-GC/MS" == "Py-GC/MS")."""
    return " ".join(name.casefold().split())


def default_identification(technique: Technique) -> IdentificationStatus:
    if technique is Technique.other:
        return IdentificationStatus.candidate
    return IdentificationStatus.confirmed


LABELS_FR: dict[str, dict[str, str]] = {
    "nature": {"published": "publiée", "laboratory": "laboratoire", "simulated": "simulée"},
    "blank": {"yes": "oui", "no": "non", "unknown": "inconnu"},
    "matrix": {"whole_blood": "sang total", "plasma": "plasma", "serum": "sérum",
               "other": "autre"},
    "status": {"quantified": "quantifié", "between_lod_loq": "entre LOD et LOQ",
               "not_quantified": "non quantifié", "below_lod": "< LOD",
               "not_analysed": "non analysé"},
    "record_type": {"sample": "échantillon", "procedural_blank": "blanc de procédure",
                    "field_blank": "blanc de terrain", "spiked": "dopé"},
    "kind": {"mass_concentration": "concentration massique",
             "number_concentration": "concentration numérique"},
    "basis": {"per_volume": "par volume", "per_mass": "par masse"},
    "technique": {"py_gc_ms": "Py-GC/MS", "ted_gc_ms": "TED-GC/MS",
                  "micro_ftir": "micro-FTIR", "micro_raman": "micro-Raman",
                  "other": "autre"},
    "polymer": {ANY: "au moins un polymère"},
}


def label_fr(group: str, code: str) -> str:
    """French display label of a vocabulary code (``group`` a LABELS_FR key); unknown
    codes, such as most polymer codes, are returned unchanged."""
    return LABELS_FR[group].get(str(code), str(code))
