from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent


@pytest.fixture
def datasets_root() -> Path:
    root = REPO_ROOT / "datasets"
    if not (root / "Spectres").exists():
        pytest.skip("datasets/Spectres not found on disk")
    return root
