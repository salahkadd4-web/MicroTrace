"""Bounded reading of multipart uploads, hashing and sheet listing."""
from __future__ import annotations

import hashlib
import io
import zipfile
from pathlib import PurePath
from typing import Protocol

from microtrace_core.results.tables import MAX_BYTES, TableReadError
from openpyxl import load_workbook

CHUNK = 64 * 1024

__all__ = ["MAX_BYTES", "TooLarge", "read_upload", "sha256_hex", "sheet_names"]


class TooLarge(TableReadError):
    """The upload exceeds the size limit."""


class _Readable(Protocol):
    async def read(self, size: int = -1) -> bytes: ...


async def read_upload(file: _Readable, max_bytes: int | None = None) -> bytes:
    """Read by chunks; stop as soon as more than ``max_bytes`` bytes have been read."""
    limit = MAX_BYTES if max_bytes is None else max_bytes
    buf = bytearray()
    while True:
        chunk = await file.read(min(CHUNK, limit + 1 - len(buf)))
        if not chunk:
            break
        buf += chunk
        if len(buf) > limit:
            raise TooLarge(
                f"Fichier trop volumineux (limite : {max(limit // (1024 * 1024), 1)} Mo)."
            )
    return bytes(buf)


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sheet_names(data: bytes, filename: str) -> list[str]:
    if PurePath(filename).suffix.lower() != ".xlsx":
        return []
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True)
    except (zipfile.BadZipFile, KeyError, OSError, ValueError) as exc:
        raise TableReadError("Fichier Excel illisible ou corrompu.") from exc
    try:
        return list(wb.sheetnames)
    finally:
        wb.close()
