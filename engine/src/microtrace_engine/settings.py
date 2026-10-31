from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

MIN_SECRET_LENGTH = 32


@dataclass(frozen=True)
class Settings:
    secret: str = field(repr=False)
    host: str = "127.0.0.1"
    port: int = 8001
    models_dir: Path = Path("models")


def load_settings() -> Settings:
    secret = os.environ.get("ENGINE_SECRET", "")
    if len(secret) < MIN_SECRET_LENGTH:
        raise ValueError(
            f"ENGINE_SECRET doit contenir au moins {MIN_SECRET_LENGTH} caractères."
        )
    host = os.environ.get("ENGINE_HOST") or "127.0.0.1"
    try:
        port = int(os.environ.get("ENGINE_PORT") or 8001)
    except ValueError:
        raise ValueError("ENGINE_PORT doit être un entier.") from None
    models_dir = Path(os.environ.get("ENGINE_MODELS_DIR") or "models")
    return Settings(secret=secret, host=host, port=port, models_dir=models_dir)
