import sys
import warnings
from dataclasses import dataclass
from pathlib import Path

import pytest
from starlette.exceptions import StarletteDeprecationWarning

# Starlette 1.x deprecates httpx in its TestClient in favour of the `httpx2`
# package. We keep the brief's `httpx` dev dependency and silence only this
# exact import-time warning here (a -W error on the command line would
# override a pytest.ini filter).
with warnings.catch_warnings():
    warnings.filterwarnings(
        "ignore",
        category=StarletteDeprecationWarning,
        message=r"Using `httpx` with `starlette\.testclient` is deprecated",
    )
    from fastapi.testclient import TestClient

from microtrace_engine.app import create_app
from microtrace_engine.settings import Settings
from microtrace_engine.spectral import ModelLock

TEST_SECRET = "s" * 40


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Settings(secret=TEST_SECRET)))


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"X-Engine-Secret": TEST_SECRET}


# --- C5: synthetic spectral model (no real weights needed) -------------------------------------

_CORE_TESTS = Path(__file__).resolve().parents[2] / "core" / "tests"


@dataclass(frozen=True)
class SpectralFixture:
    path: Path
    lock: ModelLock

    @property
    def expected_sha256(self) -> str:
        return self.lock.sha256


@pytest.fixture(scope="session")
def _spectral_archive(tmp_path_factory) -> tuple[Path, ModelLock]:
    pytest.importorskip("sklearn")
    if str(_CORE_TESTS) not in sys.path:
        sys.path.insert(0, str(_CORE_TESTS))
    from microtrace_core.spectral.archive import model_to_arrays, write_archive
    from spectral_fixtures import make_model

    folder = tmp_path_factory.mktemp("models")
    sha = write_archive(folder / "c5-spectral-s1.npz", model_to_arrays(make_model()))
    return folder, ModelLock("c5-spectral", "s1", "c5-spectral-s1.npz", sha)


@pytest.fixture
def spectral_models_dir(_spectral_archive) -> SpectralFixture:
    folder, lock = _spectral_archive
    return SpectralFixture(folder, lock)


def spectral_client(path: Path, lock: ModelLock) -> TestClient:
    return TestClient(create_app(Settings(secret=TEST_SECRET, models_dir=path), lock))
