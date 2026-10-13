# BantuLex

Linguistic data management system for Bantu languages. Imports data from Excel into a database, exports it (EvoLex Excel, GeoJSON, BLR catalog) for the map, which lives in a separate project, provides a Crouton admin app for browsing and editing the data, and publishes it as a static [Pihka](https://github.com/GhentCDH/Pihka) website.

> **Known gap:** the importer writes the **SQLite** file `data/bantulex.db` (`DB_PATH` in `utils/utils.env`), the same file the Crouton admin edits. The admin's Prisma schema and resources were introspected from an older version of that file, so they must be regenerated after an import before the admin works on it again (see [admin/README.md](admin/README.md)).

See [docs/](docs/README.md) for the data model, known data issues and the publishing workflow.

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- [just](https://github.com/casey/just) (optional, for convenience recipes)

## Quick Start

```sh
just reinit
```

This builds the containers, backs up and removes `data/bantulex.db`, and runs the import into a fresh SQLite database.

## Services

<<<<<<< HEAD

- **import** — Python/uv container for importing CSV data into SQLite
- **bantulex-map** — MapLibre-based static vector map (port 80 via proxy)
- **caddy** — Reverse proxy for all services
- **pihka**: local preview of the Pihka website on port 9161 (see [publishing](docs/publishing.md))
  ||||||| 6a99caa
- **import** — Python/uv container for importing CSV data into SQLite
- **bantulex-map** — MapLibre-based static vector map (port 80 via proxy)
- # **caddy** — Reverse proxy for all services
- **utils** — Python/uv container with the importer, exporters and documenter (run on demand)
- **admin** — Crouton admin app (UI on `/admin/`, API on `/api`) at http://localhost:4444/admin/, editing `data/bantulex.db`. It is in the `admin` compose profile, so `just up`/`just rebuild` do not start it; use `just admin`. See [admin/README.md](admin/README.md) for details.
  > > > > > > > main

## Recipes

<<<<<<< HEAD
| Command | Description |
| ------------------ | ---------------------------------- |
| `just rebuild` | Rebuild and restart all containers |
| `just up` | Start all containers |
| `just import` | Run the data import |
| `just map-up` | Build and start the map service |
| `just map-rebuild` | Force rebuild of the map service |
| `just reinit` | Rebuild + import |
| `just reset-db` | Recreate the Postgres database |
| `just pihka-init` | Fetch the pinned Pihka submodule |
| `just site-db` | Prepare the SQLite export for Pihka |
| `just pihka-up` | Preview the website locally |
| `just publish` | Build the website and rsync it |
||||||| 6a99caa
| Command | Description |
| ------------------ | ---------------------------------- |
| `just rebuild` | Rebuild and restart all containers |
| `just up` | Start all containers |
| `just import` | Run the data import |
| `just map-up` | Build and start the map service |
| `just map-rebuild` | Force rebuild of the map service |
| `just reinit` | Rebuild + import |
| `just reset-db` | Delete the SQLite database |
=======
| Command | Description |
| ------------------------ | ----------------------------------------------------------------- |
| `just rebuild` | Rebuild and restart all containers (except the admin) |
| `just up` / `just down` | Start / stop the containers |
| `just import` | Run the data import (into `data/bantulex.db`) |
| `just export-all` | Run the EvoLex, map and BLR exports (into `data/`) |
| `just reset-db` | Back up `data/bantulex.db` to `backups/` and remove it |
| `just reinit` | Rebuild + reset database + import |
| `just admin` | Build and start the admin app (needs `data/bantulex.db`) |
| `just admin-dev` | Run the admin with hot reload (UI on http://localhost:5555/admin/) |
| `just admin-test` | Typecheck, build and test the admin in its dev container |
| `just admin-e2e` | Browser tests against the host Chrome (see admin/README.md) |
| `just open-admin` | Open the admin in the browser |

The admin backs up `data/bantulex.db` into `backups/` on every start. Backups contain data and are gitignored. On Linux, `data/` and `backups/` must be writable by uid 1000.

> > > > > > > main

## Credits

Development by [Ghent Centre for Digital Humanities - Ghent University](https://www.ghentcdh.ugent.be/). Funded by the [GhentCDH research projects](https://www.ghentcdh.ugent.be/projects).

<img src="https://www.ghentcdh.ugent.be/ghentcdh_logo_blue_text_transparent_bg_landscape.svg" alt="Landscape" width="500">
