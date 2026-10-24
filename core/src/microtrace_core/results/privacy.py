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
    "birthdate", "dob", "datedenaissance", "email", "mail", "courriel", "telephone",
    "tel", "phone", "adresse", "address", "nir", "ssn", "securitesociale", "secu",
    "dossier", "ipp",
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
_PHONE_COMPANIONS = frozenset({"tel", "phone", "numero", "num", "no", "n"})
_BIRTH_COMPANIONS = frozenset({"date", "day", "dob", "of", "de", "du", "la", "le", "d"})

_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
_TOKEN = re.compile(r"[a-z0-9]+")
_DIGITS_END = re.compile(r"\d+$")


def _tokens(header: str) -> list[str]:
    folded = "".join(c for c in unicodedata.normalize("NFKD", header) if not unicodedata.combining(c))
    return _TOKEN.findall(_CAMEL.sub(" ", folded).lower())


def _bases(token: str) -> set[str]:
    """The token, without trailing digits, and without a plural ending."""
    out = {token}
    stem = _DIGITS_END.sub("", token) or token
    out.add(stem)
    for t in tuple(out):
        if t.endswith("es"):
            out.add(t[:-2])
        if t.endswith("s"):
            out.add(t[:-1])
    return out


def _header_verdict(header: str) -> str | None:
    """"error", "warning" or None for a column header."""
    toks = _tokens(header)
    joined = "".join(toks)
    bases = [_bases(t) for t in toks]
    flat = set().union(*bases) if bases else set()
    scientific = bool(flat & _QUALIFIERS)
    for b in bases:
        hit = b & _PII_TOKENS
        if hit and not (hit <= _NAME_TOKENS and scientific):
            return "error"
    if any(s in joined for s in _JOINED_SUBSTRINGS) or joined.startswith("ssn"):
        return "error"
    for i, b in enumerate(bases):
        others = set().union(*(x for j, x in enumerate(bases) if j != i), set())
        if b & {"mobile", "portable"} and (len(toks) == 1 or others & _PHONE_COMPANIONS):
            return "error"
        if "birth" in b and others <= _BIRTH_COMPANIONS:
            return "error"
    for i, t in enumerate(toks):
        rest = toks[i + 1:]
        if t in ("ne", "nee") and (rest[:1] == ["le"] or rest[:2] == ["e", "le"]):
            return "error"
    if "patient" in flat:
        return "warning"
    return None


def _name_like(text: str) -> bool:
    return (sum(c.isalpha() for c in text) >= 2
            and all(c.isalpha() or c in " -'’" for c in text))


_EMAIL = re.compile(r"[^\s@]{1,64}@[^\s@.]{1,63}(?:\.[^\s@.]{1,63}){1,8}")
_PHONE_INTL = re.compile(r"(?<![\w+])\+(?:[ .\-/()]?\d){9,15}(?!\d)")
_PHONE_FR = re.compile(r"(?<!\d)(?<!\d[.,])0\d(?:[ .\-/]?\d{2}){4}(?!\d)")
_PHONE_NANP = re.compile(r"(?<![\d\-])\(?\d{3}\)?[ .\-]\d{3}[ .\-]\d{4}(?!\d)")
_DATE = re.compile(
    r"(?<![\d/.\-])(?:(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})|(\d{4})-(\d{1,2})-(\d{1,2}))(?!\d)")


_DATE_SPAN = re.compile(
    r"(?<!\d)(?<!\d[/.\-])(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{4}|\d{2}(?![\d/.\-]\d)))"
    r"(?:[ T\-]\d{1,2}(?::\d{2}(?::\d{2})?|h\d{2}))?(?!\d)")


def _has_contact(text: str) -> bool:
    if _EMAIL.search(text):
        return True
    text = _DATE_SPAN.sub(" ", text)  # dates and datetimes are never phone numbers
    return bool(_PHONE_INTL.search(text) or _PHONE_FR.search(text) or _PHONE_NANP.search(text))


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
    patient_cols: set[str] = set()
    for col in table.columns:
        verdict = _header_verdict(col)
        if verdict == "warning":
            patient_cols.add(col)
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
            if col in patient_cols and _name_like(text.strip()):
                issues.append(Issue(
                    "E_PII_VALUE", "error",
                    "Une colonne « patient » contient une valeur qui ressemble à un nom de "
                    "personne : remplacez-la par un code pseudonymisé.", number, col))
            if col != date_col and _has_full_date(text):
                birth_counts[col] = birth_counts.get(col, 0) + 1
    for col, n in birth_counts.items():
        issues.append(Issue(
            "W_POSSIBLE_BIRTHDATE", "warning",
            f"La colonne « {col} » contient {n} cellule(s) avec une date complète pouvant être "
            "une date de naissance : vérifiez qu'elle n'identifie pas une personne.", column=col))
    return issues
