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
from microtrace_core.results.vocab import fold

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
_SPECTRO = frozenset({
    "spectra", "spectrum", "spectre", "spectroscopy", "spectroscopie", "signal", "band",
    "bande", "region", "range", "absorbance", "reflectance", "wavelength", "nm", "cm",
})
# Ambiguous words block by default; only these explicit scientific terms excuse them.
_BIRTH_EXCUSES = frozenset({
    "weight", "poids", "rate", "taux", "defect", "defaut", "order", "rang", "cohort", "cohorte",
})
_MOBILE_EXCUSES = frozenset({
    "phase", "instrument", "lab", "laboratory", "labo", "unit", "unite", "device", "appareil",
    "spectrometer", "spectrometre", "analyzer", "analyseur", "platform", "plateforme",
})
_PLACEHOLDERS = frozenset({
    "na", "nd", "n/a", "inconnu", "unknown", "temoin", "controle", "control", "blank", "blanc",
    "vide",
})

# an uppercase run followed by a lone lowercase "s" (IPPs, TELs) is not split
_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z](?:s[a-z]|[a-rt-z]))")
_TOKEN = re.compile(r"[a-z0-9]+")
_DIGITS_END = re.compile(r"\d+$")


def _tokens(header: str) -> list[str]:
    folded = "".join(c for c in unicodedata.normalize("NFKD", header) if not unicodedata.combining(c))
    return _TOKEN.findall(_CAMEL.sub(" ", folded).lower())


def _bases(token: str) -> set[str]:
    """The token, without trailing digits, and without a plural ending."""
    out = {token, _DIGITS_END.sub("", token) or token}
    for t in tuple(out):
        if t.endswith("ies"):
            out.add(t[:-3] + "y")
        if t.endswith("es"):
            out.add(t[:-2])
        if t.endswith("s"):
            out.add(t[:-1])
    return out


def _header_verdict(header: str) -> str | None:
    """"error", "warning" or None for a column header (linear in the header length)."""
    toks = _tokens(header[:MAX_SCAN_CHARS])
    joined = "".join(toks)
    bases = [_bases(t) for t in toks]
    flat: set[str] = set().union(*bases)
    scientific = bool(flat & _QUALIFIERS)
    for b in bases:
        for hit in b & _PII_TOKENS:
            if hit in _NAME_TOKENS and scientific:
                continue
            if hit == "nir" and flat & _SPECTRO:
                continue
            return "error"
    if (any(s in joined for s in _JOINED_SUBSTRINGS)
            or "ssnumber" in joined or "socialsecurity" in joined):
        return "error"
    if any(x.startswith("birth") for x in flat) and not flat & (_BIRTH_EXCUSES | _QUALIFIERS):
        return "error"
    if flat & {"mobile", "portable"} and not flat & (_MOBILE_EXCUSES | _QUALIFIERS):
        return "error"
    for i, t in enumerate(toks):
        if t in ("ne", "nee") and (toks[i + 1:i + 2] == ["le"] or toks[i + 1:i + 3] == ["e", "le"]):
            return "error"
    if "patient" in flat:
        return "warning"
    return None


def _name_like(text: str) -> bool:
    if fold(text.strip(". ")) in _PLACEHOLDERS:
        return False
    return (sum(c.isalpha() for c in text) >= 2
            and all(c.isalpha() or c in " -'’,._" for c in text))


_EMAIL = re.compile(r"[^\s@]{1,64}@[^\s@.]{1,63}(?:\.[^\s@.]{1,63}){1,8}")
_PHONES = (
    re.compile(r"(?<![\w+])\+(?:[ .\-/()]?\d){9,15}(?!\d)"),
    re.compile(r"(?<!\d)(?<!\d[.,])0\d(?:[ .\-/]?\d{2}){4}(?!\d)"),
    re.compile(r"(?<![\d\-])\(?\d{3}\)?[ .\-]\d{3}[ .\-]\d{4}(?!\d)"),
)
_DATE = re.compile(
    r"(?<![\d/.\-])(?:(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})|(\d{4})-(\d{1,2})-(\d{1,2}))(?!\d)")
_DATE_SPAN = re.compile(
    r"(?<!\d)(?<!\d[/.\-])(?P<date>(?:(?P<y1>\d{4})-(?P<m1>\d{1,2})-(?P<d1>\d{1,2})"
    r"|(?P<d2>\d{1,2})[/.\-](?P<m2>\d{1,2})[/.\-](?P<y2>\d{4}|\d{2}(?![\d/.\-]\d))))"
    r"(?P<time>[ T\-](?P<h>\d{1,2})(?::(?P<mi>\d{2})(?::(?P<se>\d{2}))?|h(?P<mh>\d{2})))?(?!\d)")


def _valid_date_spans(text: str) -> list[tuple[int, int]]:
    """Spans of validated dates / datetimes (real calendar day, real clock time)."""
    spans: list[tuple[int, int]] = []
    for m in _DATE_SPAN.finditer(text):
        if m.group("y1"):
            y, mo, d = int(m.group("y1")), int(m.group("m1")), int(m.group("d1"))
        else:
            y, mo, d = int(m.group("y2")), int(m.group("m2")), int(m.group("d2"))
            if len(m.group("y2")) == 2:
                y += 2000
        try:
            date(y, mo, d)
        except ValueError:
            continue
        end = m.end("date")
        if m.group("time"):
            minute = m.group("mi") or m.group("mh") or "0"
            if int(m.group("h")) <= 23 and int(minute) <= 59 and int(m.group("se") or 0) <= 59:
                end = m.end()
        spans.append((m.start(), end))
    return spans


def _has_contact(text: str) -> bool:
    if _EMAIL.search(text):
        return True
    spans: list[tuple[int, int]] | None = None
    for pattern in _PHONES:
        for m in pattern.finditer(text):
            if spans is None:
                spans = _valid_date_spans(text)
            # a phone-shaped match entirely inside a validated date/datetime is a date
            if not any(a <= m.start() and m.end() <= b for a, b in spans):
                return True
    return False


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
