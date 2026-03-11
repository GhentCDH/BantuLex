# syntax=docker/dockerfile:1
# ── BantuLex Python tools (import + export) ─────────────────────────────────
# One container that holds every CLI tool:
#   uv run import
#   uv run export-evolex
#   uv run export-map
#   uv run export-vowel

FROM ghcr.io/astral-sh/uv:python3.13-trixie-slim

WORKDIR /app

# avoids hardlink issues in containers
ENV UV_LINK_MODE=copy

# copy combined dependency files
COPY pyproject.toml uv.lock ./
COPY README.md ./

# copy sub-package files
COPY import/pyproject.toml import/README.md ./import/
COPY export/pyproject.toml export/README.md ./export/

# copy source trees
COPY import/src ./import/src/
COPY export/src ./export/src/

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev

# keep container alive for docker compose exec
CMD ["tail", "-f", "/dev/null"]