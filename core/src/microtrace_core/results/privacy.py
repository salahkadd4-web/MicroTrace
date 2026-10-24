"""Personal-data detection on raw tables (headers and every cell).

Issue codes: E_PII_COLUMN (error), E_PII_VALUE (error), W_POSSIBLE_PII_COLUMN
(warning, a "patient" header: check that it is a pseudonymised code) and
W_POSSIBLE_BIRTHDATE (warning, one per column). ``column`` is the file column and
``field`` the standard field it is mapped to, if any.

Messages never repeat the offending cell value, so that personal data does not
leak into reports or logs. Header checks are token based and never disabled by a
column mapping. A header that itself holds an e-mail address or a phone number is
an E_PII_COLUMN named by its position only ("colonne n° 3", ``column`` None); its
cells are not scanned, so that no issue repeats that header. Every value pattern uses bounded quantifiers and only the first
MAX_SCAN_CHARS characters of a cell are scanned (no catastrophic backtracking).
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date

from microtrace_core.results.issues import Issue, issue
from microtrace_core.results.mapping import Mapping
from microtrace_core.results.tables import MAX_SCAN_CHARS, RawTable
from microtrace_core.results.vocab import fold

__all__ = ["MAX_SCAN_CHARS", "detect_pii", "header_has_contact"]

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
    "compound", "material", "materiau", "species", "series", "commercial", "trade", "brand",
    "common", "analysis", "analyse",
})
# a nom/name token is never excused when the header also names a person
_PERSON = frozenset({
    "patient", "donneur", "donor", "personne", "person", "sujet", "subject", "participant",
    "volontaire", "volunteer",
})
_SPECTRO = frozenset({
    "spectra", "spectrum", "spectre", "spectroscopy", "spectroscopie", "signal", "band",
    "bande", "region", "range", "absorbance", "reflectance", "wavelength", "nm", "cm",
})
# Ambiguous words block by default; only these explicit scientific terms excuse them
# (the name qualifiers above never do).
_BIRTH_EXCUSES = frozenset({
    "weight", "poids", "rate", "taux", "defect", "defaut", "order", "rang", "cohort", "cohorte",
})
_MOBILE_EXCUSES = frozenset({
    "phase", "instrument", "unit", "unite", "device", "appareil", "spectrometer", "spectrometre",
    "analyzer", "analyseur", "platform", "plateforme", "ftir", "raman", "xrf", "nirs",
})
# compared after folding and removing every non-alphanumeric character ("N.A." -> "na")
_PLACEHOLDERS = frozenset({
    "na", "nd", "nr", "nc", "inconnu", "unknown", "temoin", "temoins", "controle", "controles",
    "control", "controls", "blank", "blanks", "blanc", "blancs", "vide", "pool", "qc", "standard",
})
_NON_ALNUM = re.compile(r"[^a-z0-9]+")

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
    scientific = bool(flat & _QUALIFIERS) and not flat & _PERSON
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
    if not flat & _BIRTH_EXCUSES:
        for b in bases:
            # "birthweight", "birthrates": one token, birth + an excuse word
            if (any(x.startswith("birth") for x in b)
                    and not any(x[5:] in _BIRTH_EXCUSES for x in b)):
                return "error"
    if (flat & {"mobile", "portable"} and not flat & _MOBILE_EXCUSES
            and not any(x.startswith("spectro") for x in flat)):
        return "error"
    for i, t in enumerate(toks):
        if t in ("ne", "nee") and (toks[i + 1:i + 2] == ["le"] or toks[i + 1:i + 3] == ["e", "le"]):
            return "error"
    if "patient" in flat:
        return "warning"
    return None


def _name_like(text: str) -> bool:
    if _NON_ALNUM.sub("", fold(text)) in _PLACEHOLDERS:
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


def _valid_date_spans(text: str) -> list[tuple[int, int, bool]]:
    """(start, end, 4-digit year) of validated dates / datetimes (real day, real clock time)."""
    spans: list[tuple[int, int, bool]] = []
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
        spans.append((m.start(), end, len(m.group("y1") or m.group("y2")) == 4))
    return spans


def _is_date(m: re.Match[str], french: bool, spans: list[tuple[int, int, bool]]) -> bool:
    """A phone-shaped match entirely inside a validated date/datetime is a date; a French
    match starting inside a 4-digit-year date ("05/06/2021 10 mL") is a dated measurement."""
    return any((a <= m.start() and m.end() <= b) or (french and long_year and a <= m.start() < b)
               for a, b, long_year in spans)


def _has_contact(text: str) -> bool:
    if _EMAIL.search(text):
        return True
    spans: list[tuple[int, int, bool]] | None = None
    for pattern in _PHONES:
        french = pattern is _PHONES[1]
        pos = 0
        while (m := pattern.search(text, pos)) is not None:
            if spans is None:
                spans = _valid_date_spans(text)
            if not _is_date(m, french, spans):
                return True
            # retry just after the start: a dropped match may overlap a real phone
            pos = m.start() + 1
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


def header_has_contact(header: str) -> bool:
    """True if the header itself holds an e-mail address or a phone number."""
    return _has_contact(header[:MAX_SCAN_CHARS])


def detect_pii(table: RawTable, mapping: Mapping) -> list[Issue]:
    issues: list[Issue] = []
    patient_cols: set[str] = set()
    hidden: set[str] = set()  # headers holding contact data: never repeated, cells not scanned
    fields: dict[str, str] = {}  # file column -> standard field it is mapped to
    for name, mapped in mapping.field_columns.items():
        fields.setdefault(mapped, name)
    for position, col in enumerate(table.columns, 1):
        if header_has_contact(col):
            hidden.add(col)
            issues.append(issue(
                "E_PII_COLUMN",
                f"L'en-tête de la colonne n° {position} contient une adresse e-mail ou un numéro "
                "de téléphone : retirez cette donnée personnelle du fichier avant l'import.",
                field=fields.get(col)))
            continue
        verdict = _header_verdict(col)
        if verdict == "warning":
            patient_cols.add(col)
        if verdict == "error":
            issues.append(issue(
                "E_PII_COLUMN",
                f"La colonne « {col} » semble contenir des données personnelles : "
                "retirez-la du fichier avant l'import.", column=col, field=fields.get(col)))
        elif verdict == "warning":
            issues.append(issue(
                "W_POSSIBLE_PII_COLUMN",
                f"La colonne « {col} » mentionne un patient : vérifier qu'il s'agit d'un "
                "code pseudonymisé et non d'une identité.", column=col, field=fields.get(col)))
    date_col = mapping.field_columns.get("analysis_date")
    birth_counts: dict[str, int] = {}
    scanned = [col for col in table.columns if col not in hidden]
    for row, number in zip(table.rows, table.row_numbers, strict=True):
        for col in scanned:
            text = row.get(col, "")
            if not text:
                continue
            text = text[:MAX_SCAN_CHARS]
            if _has_contact(text):
                issues.append(issue(
                    "E_PII_VALUE",
                    "Une cellule contient une adresse e-mail ou un numéro de téléphone : "
                    "retirez cette donnée personnelle avant l'import.", number, col,
                    fields.get(col)))
            if col in patient_cols and _name_like(text.strip()):
                issues.append(issue(
                    "E_PII_VALUE",
                    "Une colonne « patient » contient une valeur qui ressemble à un nom de "
                    "personne : remplacez-la par un code pseudonymisé.", number, col,
                    fields.get(col)))
            if col != date_col and _has_full_date(text):
                birth_counts[col] = birth_counts.get(col, 0) + 1
    for col, n in birth_counts.items():
        issues.append(issue(
            "W_POSSIBLE_BIRTHDATE",
            f"La colonne « {col} » contient {n} cellule(s) avec une date complète pouvant être "
            "une date de naissance : vérifiez qu'elle n'identifie pas une personne.", column=col,
            field=fields.get(col)))
    return issues
