import warnings

import pytest

# Starlette 1.x deprecates httpx in its TestClient in favour of the `httpx2`
# package. We keep the brief's `httpx` dev dependency and silence only this
# exact import-time warning here (a -W error on the command line would
# override a pytest.ini filter).
with warnings.catch_warnings():
    warnings.filterwarnings(
        "ignore",
        message=r"Using `httpx` with `starlette\.testclient` is deprecated",
    )
    from fastapi.testclient import TestClient

from microtrace_engine.app import create_app
from microtrace_engine.settings import Settings

TEST_SECRET = "s" * 40


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Settings(secret=TEST_SECRET)))


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"X-Engine-Secret": TEST_SECRET}
