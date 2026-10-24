"""Personal-data detection on raw tables (headers and every cell).

Issue codes: E_PII_COLUMN (error), E_PII_VALUE (error), W_POSSIBLE_PII_COLUMN
(warning, a "patient" header: check that it is a pseudonymised code) and
W_POSSIBLE_BIRTHDATE (warning, one per column).

Messages never repeat the offending cell value, so that personal data does not
leak into reports or logs. Header checks are token based and never disabled by a
column mapping. Every value pattern uses bounded quantifiers and only the first
MAX_SCAN_CHARS characters of a cell are scanned (no catastrophic backtracking).
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date

from microtrace_core.results.issues import Issue
from microtrace_core.results.mapping import Mapping
from microtrace_core.results.tables import RawTable

MAX_SCAN_CHARS = 1000

_PII_TOKENS = frozenset({
    "nom", "name", "fullname", "prenom", "firstname", "lastname", "surname", "naissance",
    "birth", "birthdate", "dob", "datedenaissance", "email", "mail", "courriel", "telephone",
    "tel", "phone", "mobile", "portable", "adresse", "address", "nir", "ssn",
    "securitesociale", "dossier", "ipp",
})
_JOINED_SUBSTRINGS = (
    "naissance", "datedenaissance", "securitesociale", "telephone", "firstname", "lastname",
    "birthdate",
)
_NAME_TOKENS = frozenset({"nom", "name"})
_QUALIFIERS = frozenset({
    "sample", "echantillon", "polymer", "polymere", "product", "produit", "method", "methode",
    "lab", "labo", "study", "etude", "file", "fichier", "batch", "lot", "instrument",
    "compound", "material", "materiau",
})

_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_TOKEN = re.compile(r"[a-z0-9]+")


def _tokens(header: str) -> list[str]:
    folded = "".join(c for c in unicodedata.normalize("NFKD", header) if not unicodedata.combining(c))
    return _TOKEN.findall(_CAMEL.sub(" ", folded).lower())


def _header_verdict(header: str) -> str | None:
    """"error", "warning" or None for a column header."""
    toks = _tokens(header)
    joined = "".join(toks)
    scientific = any(t in _QUALIFIERS for t in toks)
    for t in toks:
        if t in _PII_TOKENS and not (t in _NAME_TOKENS and scientific):
            return "error"
    if any(s in joined for s in _JOINED_SUBSTRINGS):
        return "error"
    if "patient" in toks:
        return "warning"
    return None


_EMAIL = re.compile(r"[^\s@]{1,64}@[^\s@.]{1,63}(?:\.[^\s@.]{1,63}){1,8}")
_PHONE_INTL = re.compile(r"(?<![\w+])\+(?:[ .\-/()]?\d){9,15}(?!\d)")
_PHONE_FR = re.compile(r"(?<!\d)(?<!\d[.,])0\d(?:[ .\-/]?\d{2}){4}(?!\d)")
_PHONE_NANP = re.compile(r"(?<![\d\-])\(?\d{3}\)?[ .\-]\d{3}[ .\-]\d{4}(?!\d)")
_DATE = re.compile(
    r"(?<![\d/.\-])(?:(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})|(\d{4})-(\d{1,2})-(\d{1,2}))(?!\d)")


def _has_contact(text: str) -> bool:
    return bool(_EMAIL.search(text) or _PHONE_INTL.search(text)
                or _PHONE_FR.search(text) or _PHONE_NANP.search(text))


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
    for col in table.columns:
        verdict = _header_verdict(col)
        if verdict == "error":
            issues.append(Issue(
                "E_PII_COLUMN", "error",
                f"La colonne « {col} » semble contenir des données personnelles : "
                "retirez-la du fichier avant l'import.", column=col))
        elif verdict == "warning":
            issues.append(Issue(
                "W_POSSIBLE_PII_COLUMN", "warning",
                f"La colonne « {col} » mentionne un patient : vérifier qu'il s'agit d'un "
                "code pseudonymisé et non d'une identité.", column=col))
    date_col = mapping.field_columns.get("analysis_date")
    birth_counts: dict[str, int] = {}
    for row, number in zip(table.rows, table.row_numbers, strict=True):
        for col in table.columns:
            text = row.get(col, "")
            if not text:
                continue
            text = text[:MAX_SCAN_CHARS]
            if _has_contact(text):
                issues.append(Issue(
                    "E_PII_VALUE", "error",
                    "Une cellule contient une adresse e-mail ou un numéro de téléphone : "
                    "retirez cette donnée personnelle avant l'import.", number, col))
            if col != date_col and _has_full_date(text):
                birth_counts[col] = birth_counts.get(col, 0) + 1
    for col, n in birth_counts.items():
        issues.append(Issue(
            "W_POSSIBLE_BIRTHDATE", "warning",
            f"La colonne « {col} » contient {n} cellule(s) avec une date complète pouvant être "
            "une date de naissance : vérifiez qu'elle n'identifie pas une personne.", column=col))
    return issues
