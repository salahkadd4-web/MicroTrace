"""Contact data (e-mail, phone) detection shared by the table reader and the privacy checks.

Kept free of any other package import so that tables.py can use it without a cycle.
"""
from __future__ import annotations

import re
from datetime import date

# text scanners (personal data, header units, field synonyms) only read this many characters
MAX_SCAN_CHARS = 1000

_EMAIL = re.compile(r"[^\s@]{1,64}@[^\s@.]{1,63}(?:\.[^\s@.]{1,63}){1,8}")
_PHONES = (
    re.compile(r"(?<![\w+])\+(?:[ .\-/()]?\d){9,15}(?!\d)"),
    re.compile(r"(?<!\d)(?<!\d[.,])0\d(?:[ .\-/]?\d{2}){4}(?!\d)"),
    re.compile(r"(?<![\d\-])\(?\d{3}\)?[ .\-]\d{3}[ .\-]\d{4}(?!\d)"),
)
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


def header_has_contact(header: str) -> bool:
    """True if the header itself holds an e-mail address or a phone number."""
    return _has_contact(header[:MAX_SCAN_CHARS])


def header_label(header: str, position: int) -> str:
    """How a message may name a header: by position when it is long (only its prefix is
    scanned for personal data) or holds contact data, else quoted."""
    if len(header) > MAX_SCAN_CHARS or header_has_contact(header):
        return f"colonne n° {position}"
    return f"colonne « {header} »"
