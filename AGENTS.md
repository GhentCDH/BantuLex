# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BantuLex is a linguistic data management system for Bantu languages, built for the Ghent Centre for Digital Humanities. It imports Excel/CSV data into a SQLite database (`data/bantulex.db`) and provides a Crouton web admin app on that file. The exporters produce the data for the geographic/phonological map, which lives in a separate project.

## Common Commands

All task automation uses `just` (see `justfile`):

```bash
just up           # Start all containers (except the admin profile)
just down         # Stop all containers
just rebuild      # Rebuild and restart all containers (except the admin profile)
just reinit       # Full reset: rebuild + reset DB + import
just import       # Run data import (Excel/CSV → data/bantulex.db)
just export-all   # Run all exporters
just export-evolex  # Export to EvoLex Excel format
just export-tofix   # Worklist of import errors/warnings → data/to_fix.html (links to /admin)
just migrate-db   # Add new tables/columns from model.py to an existing data/bantulex.db
just reset-db     # Back up data/bantulex.db to backups/ and remove it
just admin        # Build + start the Crouton admin (compose profile "admin", :4444/admin/)
just admin-dev    # Admin with hot reload (admin/docker-compose.yml, dev profile)
just admin-test   # Admin typecheck, build and API tests in its dev container
just admin-e2e    # Admin browser tests: Playwright in the container drives the host Chrome over CDP
```

Python tools can also be run directly via Docker:

```bash
docker compose run --rm utils uv run importer
docker compose run --rm utils uv run export-evolex
```

The Python workspace uses `uv` — there is no formal test suite.

## Architecture

### Data Flow

```
Excel/CSV files
      ↓
  [Importer] — Python, openpyxl, SQLModel
      ↓
  data/bantulex.db — SQLite (DB_PATH in utils/utils.env) ←→ [Crouton Admin] (NestJS API /api + Vue UI /admin/, admin/)
      ↓
  [Exporters]
  ├─ EvoLex (Excel)
  └─ to-fix worklist (HTML)
        ↓
  data/
```

The admin's Prisma schema and resources are introspected from `data/bantulex.db`; when `model.py` changes, update them as described in `admin/README.md`.

### Services (Docker Compose)

| Service           | Port | Description                                           |
| ----------------- | ---- | ----------------------------------------------------- |
| `admin`           | 4444 | Crouton admin app; `admin` profile, edits `data/bantulex.db`, backups in `backups/` (see `admin/README.md`) |
| `utils`           | —    | Python build context for import/export tools          |

### Python Workspace (`utils/`)

Managed as a `uv` workspace with four packages:

- **`importer/`** — reads Excel/CSV, validates, inserts into the SQLite database (`DB_PATH`). Entry point: `src/importer/cli.py`
- **`exporter/`** — two separate scripts (EvoLex, to-fix worklist)
- **`utilities/`** — shared code: SQLModel ORM definitions (`model.py`), DB connection, config
- **`documenter/`** — schema visualization tool

The canonical data model is in [utils/utilities/src/utilities/model.py](utils/utilities/src/utilities/model.py). Key tables: `Variety`, `Reflex`, `Reconstruction`, `Location`, `Fieldwork`, `Source`, `SourceEntries`.

## Configuration

- Python tools: `utils/utils.env` (`DB_PATH`, `DATA_ROOT`, optional `EXCEL_FILE`, optional `BLR_FILE`); `dev.env` is loaded by Docker Compose for `utils`.
- Admin: `HOST`, `PORT`, `DATABASE_PATH`, `BACKUP_DIR` (defaults in `admin/Dockerfile`); it has no login, so only expose it on localhost or behind an authenticating proxy.

Production deployment targets Nomad (see `ARCHITECTURE.md`); Docker Compose is for local dev only.
