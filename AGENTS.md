# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BantuLex is a linguistic data management system for Bantu languages, built for the Ghent Centre for Digital Humanities. It imports Excel/CSV data into SQLite and provides a web admin UI and interactive geographic/phonological map.

## Common Commands

All task automation uses `just` (see `justfile`):

```bash
just up           # Start all containers
just down         # Stop all containers
just rebuild      # Rebuild and restart all containers
just reinit       # Full reset: rebuild + reset DB + import + download map data
just import       # Run data import (Excel/CSV → SQLite)
just export-all   # Run all three exporters
just export-evolex  # Export to EvoLex Excel format
just export-map     # Export linguistic data as GeoJSON
just export-blr     # Export BLR phonological data + catalog
just map-data     # Download Protomaps Africa basemap (pmtiles)
just reset-db     # Delete SQLite database
```

Python tools can also be run directly via Docker:

```bash
docker compose run --rm utils uv run importer
docker compose run --rm utils uv run export-blr
```

The Python workspace uses `uv` — there is no formal test suite.

## Architecture

### Data Flow

```
Excel/CSV files
      ↓
  [Importer] — Python, openpyxl, SQLModel
      ↓
  SQLite DB (bantulex.db, STRICT mode)
      ↓
  ┌───┴──────────────────────────────┐
  ↓                                  ↓
[Exporters]                  [Kottster Admin UI]
├─ EvoLex (Excel)            (Node.js, React 19)
├─ GeoJSON (map)
└─ BLR catalog (JSON)
        ↓
  [Local Map UI]
  (MapLibre GL JS + Klankzoeker)
```

### Services (Docker Compose)

| Service           | Port | Description                                           |
| ----------------- | ---- | ----------------------------------------------------- |
| `data-management` | 5480 | Kottster admin panel (Node.js)                        |
| `gateway`         | 9160 | Caddy reverse proxy; serves `local-map/` static files |
| `utils`           | —    | Python build context for import/export tools          |

### Python Workspace (`utils/`)

Managed as a `uv` workspace with three packages:

- **`importer/`** — reads Excel/CSV, validates, inserts into SQLite. Entry point: `src/importer/cli.py`
- **`exporter/`** — three separate scripts (EvoLex, GeoJSON, BLR)
- **`utilities/`** — shared code: SQLModel ORM definitions (`model.py`), DB connection, config
- **`documenter/`** — schema visualization tool

The canonical data model is in [utils/utilities/src/utilities/model.py](utils/utilities/src/utilities/model.py). Key tables: `Variety`, `Entry`, `Location`, `Fieldwork`, `Source`, `SourceEntries`, `BLREntry`.

### Map UI (`local-map/`)

Static HTML/JS using MapLibre GL JS. Displays GeoJSON exports with clustering. Includes a "Klankzoeker" (sound search) for BLR phonological data. Served by Caddy from the `local-map/dist/` directory.

## Configuration

Development environment variables are in `dev.env` (loaded by Docker Compose):

- `PORT=5480`
- Kottster identity DB: `/data/app.db`, default credentials: `admin/admin`

Production deployment targets Nomad (see `ARCHITECTURE.md`); Docker Compose is for local dev only.
