"""Personal-data detection on raw tables (headers and every cell).

Messages never repeat the offending cell value, so that personal data does not
leak into reports or logs.
"""
from __future__ import annotations

import re
from datetime import date

from microtrace_core.results.issues import Issue
from microtrace_core.results.mapping import Mapping, _norm
from microtrace_core.results.tables import RawTable

_PII_KEYWORDS = (
    "nom", "name", "prenom", "firstname", "lastname", "surname", "naissance", "birth", "dob",
    "email", "mail", "telephone", "phone", "tel", "adresse", "address", "securitesociale",
    "ssn", "nir", "dossier", "patient",
)

_EMAIL = re.compile(r"\S+@\S+\.\w+")
# a run of digits with optional phone separators, not glued to a word or a decimal part
_NUMBER_RUN = re.compile(r"(?<![\w.,])\+?\(?\d(?:[\d ().\-]*\d)?")
_SEPARATORS = re.compile(r"[ ().\-]+")
_DATE = re.compile(r"(?<![\d/.\-])(?:(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})|(\d{4})-(\d{1,2})-(\d{1,2}))(?!\d)")


def _is_phone(run: str) -> bool:
    digits = sum(c.isdigit() for c in run)
    if digits < 9:
        return False
    if run.startswith("+"):
        return True
    groups = [g for g in _SEPARATORS.split(run.strip("() ")) if g]
    if len(groups) >= 3:
        return True
    return len(groups) == 1 and run[0] == "0"  # 0 followed by at least 8 more digits


def _has_contact(text: str) -> bool:
    return bool(_EMAIL.search(text)) or any(_is_phone(m.group()) for m in _NUMBER_RUN.finditer(text))


def _has_full_date(text: str) -> bool:
    for m in _DATE.finditer(text):
        d, mo, y = ((int(m.group(1)), int(m.group(2)), int(m.group(3))) if m.group(1)
                    else (int(m.group(6)), int(m.group(5)), int(m.group(4))))
        try:
            date(y, mo, d)
        except ValueError:
            continue
        return True
    return False


def detect_pii(table: RawTable, mapping: Mapping) -> list[Issue]:
    issues: list[Issue] = []
    exempt = {col for name, col in mapping.field_columns.items() if name != "sample_id"}
    exempt |= set(mapping.polymer_columns)
    for col in table.columns:
        if col in exempt:
            continue
        key = _norm(col)
        if any(k in key for k in _PII_KEYWORDS):
            issues.append(Issue(
                "E_PII_COLUMN", "error",
                f"La colonne « {col} » semble contenir des données personnelles : "
                "retirez-la du fichier avant l'import.", column=col))
    date_col = mapping.field_columns.get("analysis_date")
    for row, number in zip(table.rows, table.row_numbers, strict=True):
        for col in table.columns:
            text = row.get(col, "")
            if not text:
                continue
            if _has_contact(text):
                issues.append(Issue(
                    "E_PII_VALUE", "error",
                    "Une cellule contient une adresse e-mail ou un numéro de téléphone : "
                    "retirez cette donnée personnelle avant l'import.", number, col))
            if col != date_col and _has_full_date(text):
                issues.append(Issue(
                    "W_POSSIBLE_BIRTHDATE", "warning",
                    "Une cellule contient une date complète pouvant être une date de naissance : "
                    "vérifiez qu'elle n'identifie pas une personne.", number, col))
    return issues
