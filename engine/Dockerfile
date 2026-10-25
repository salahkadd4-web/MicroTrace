# Build from the repository root:  docker build -f engine/Dockerfile -t microtrace-engine .
FROM python:3.12.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    ENGINE_HOST=0.0.0.0

WORKDIR /app
COPY core/pyproject.toml core/pyproject.toml
COPY core/src core/src
COPY engine/pyproject.toml engine/pyproject.toml
COPY engine/src engine/src
RUN pip install ./core ./engine

RUN useradd --system --no-create-home --uid 10001 engine
USER engine

# ENGINE_SECRET (>= 32 characters) must be supplied at run time; there is no default.
EXPOSE 8001
CMD ["python", "-m", "microtrace_engine"]
