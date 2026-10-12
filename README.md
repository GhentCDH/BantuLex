# BantuLex

Linguistic data management system for Bantu languages. Imports data from Excel into a database, exports it (EvoLex Excel, GeoJSON, BLR catalog) for an interactive map, and provides a Crouton admin app for browsing and editing the data.

> **Known gap:** the importer currently writes to **Postgres** (`DATABASE_URL` in `utils/utils.env`), while the Crouton admin edits the **SQLite** file `data/bantulex.db`. Nothing in this repository currently produces or syncs that SQLite file from Postgres; a Postgres datasource for the admin is future work.

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- [just](https://github.com/casey/just) (optional, for convenience recipes)

## Quick Start

```sh
just reinit
```

This builds and starts the containers, recreates the Postgres database, runs the import and downloads the map data.

## Services

- **utils** — Python/uv container with the importer, exporters and documenter (run on demand)
- **postgres** — Postgres 17 database written by the importer (port 5432)
- **gateway** — Caddy; serves the static map from `local-map/` (http://localhost:9160)
- **admin** — Crouton admin app (UI on `/admin/`, API on `/api`) at http://localhost:4444/admin/, editing `data/bantulex.db`. It is in the `admin` compose profile, so `just up`/`just rebuild` do not start it; use `just admin`. See [admin/README.md](admin/README.md) for details.

## Recipes

| Command                  | Description                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| `just rebuild`           | Rebuild and restart all containers (except the admin)             |
| `just up` / `just down`  | Start / stop the containers                                       |
| `just import`            | Run the data import (into Postgres)                               |
| `just export-all`        | Run the EvoLex, map and BLR exports                               |
| `just map-data`          | Download the Protomaps basemap into `local-map/data/`             |
| `just reset-db`          | Drop and recreate the Postgres database                           |
| `just reinit`            | Rebuild + reset database + import + map data                      |
| `just admin`             | Build and start the admin app (needs `data/bantulex.db`)          |
| `just admin-dev`         | Run the admin with hot reload (UI on http://localhost:5555/admin/) |
| `just admin-test`        | Typecheck, build and test the admin in its dev container          |
| `just admin-e2e`         | Browser tests against the host Chrome (see admin/README.md)        |
| `just open` / `just open-admin` | Open the map / the admin in the browser                    |

The admin backs up `data/bantulex.db` into `backups/` on every start. Backups contain data and are gitignored. On Linux, `data/` and `backups/` must be writable by uid 1000.

## Credits

Development by [Ghent Centre for Digital Humanities - Ghent University](https://www.ghentcdh.ugent.be/). Funded by the [GhentCDH research projects](https://www.ghentcdh.ugent.be/projects).

<img src="https://www.ghentcdh.ugent.be/ghentcdh_logo_blue_text_transparent_bg_landscape.svg" alt="Landscape" width="500">
