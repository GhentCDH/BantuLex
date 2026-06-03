FROM ghcr.io/astral-sh/uv:python3.13-trixie-slim AS uv

WORKDIR /app

# avoids hardlink issues in containers
ENV UV_LINK_MODE=copy
# isolate container venv from host's bind-mounted .venv (different Python ABI)
ENV UV_PROJECT_ENVIRONMENT=/opt/venv

RUN apt-get update && apt-get install -y --no-install-recommends graphviz

