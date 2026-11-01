"""Deterministic, pickle-free ``.npz`` model archives (shared by every model family)."""
from __future__ import annotations

import hashlib
import io
import zipfile
from collections.abc import Mapping
from pathlib import Path

import numpy as np

FIXED_DATE = (1980, 1, 1, 0, 0, 0)


def archive_bytes(arrays: Mapping[str, np.ndarray]) -> bytes:
    """Serialise arrays to a byte-deterministic zip of ``.npy`` files (sorted names)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name in sorted(arrays):
            arr = np.asarray(arrays[name])
            if arr.dtype.hasobject:
                raise ValueError(f"array {name!r} has object dtype: pickle is not allowed")
            body = io.BytesIO()
            np.lib.format.write_array(body, arr, version=(1, 0), allow_pickle=False)
            info = zipfile.ZipInfo(f"{name}.npy", date_time=FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o600 << 16
            zf.writestr(info, body.getvalue(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    return buf.getvalue()


def write_archive(path: Path, arrays: Mapping[str, np.ndarray]) -> str:
    """Write the archive and return its sha256 (hex)."""
    data = archive_bytes(arrays)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def read_archive(data: bytes) -> dict[str, np.ndarray]:
    try:
        with np.load(io.BytesIO(data), allow_pickle=False) as z:
            return {k: z[k] for k in z.files}
    except Exception as exc:  # noqa: BLE001 - any unreadable archive is invalid
        raise ValueError(f"invalid model archive: unreadable ({type(exc).__name__})") from None
