# BantuLex

Linguistic data management system for Bantu languages. Imports data from Excel into a database, exports it (EvoLex Excel and a to-fix worklist), provides a Crouton admin app for browsing and editing the data, and publishes it as a static website with its own UI on the [Pihka](https://github.com/GhentCDH/Pihka) engine.

> The importer writes the **SQLite** file `data/bantulex.db` (`DB_PATH` in `utils/utils.env`), the same file the Crouton admin edits. When the importer's schema changes, the admin's Prisma schema and resources must follow (see [admin/README.md](admin/README.md)).

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

- **utils** — Python/uv container with the importer, exporters and documenter (run on demand)
- **admin** — Crouton admin app (UI on `/admin/`, API on `/api`) at http://localhost:4444/admin/, editing `data/bantulex.db`. It is in the `admin` compose profile, so `just up`/`just rebuild` do not start it; use `just admin`. See [admin/README.md](admin/README.md) for details.
- **caddy** — web server on http://localhost:9161, as in deployment: the Pihka website on `/` and the admin on `/admin/` and `/api` (`Caddyfile`, see [publishing](docs/publishing.md))

## Recipes

| Command | Description |
| ------------------------ | ----------------------------------------------------------------- |
| `just rebuild` | Rebuild and restart all containers (except the admin) |
| `just up` / `just down` | Start / stop the containers |
| `just import` | Run the data import (into `data/bantulex.db`) |
| `just export-all` | Run the EvoLex and to-fix exports (into `data/`) |
| `just export-tofix` | Worklist of import errors and warnings with admin links: `data/to_fix.html` |
| `just migrate-db` | Add new tables/columns from `model.py` to an existing `data/bantulex.db` (keeps admin edits) |
| `just reset-db` | Back up `data/bantulex.db` to `backups/` and remove it |
| `just reinit` | Rebuild + reset database + import |
| `just admin` | Build and start the admin app (needs `data/bantulex.db`) |
| `just admin-dev` | Run the admin with hot reload (UI on http://localhost:5555/admin/) |
| `just admin-test` | Typecheck, build and test the admin in its dev container |
| `just admin-e2e` | Browser tests against the host Chrome (see admin/README.md) |
| `just open-admin` | Open the admin in the browser |
| `just pihka-init` | Fetch the pinned Pihka submodule |
| `just pihka-up` | Preview the website locally |
| `just publish` | Build the website and rsync it |

The admin does not make backups; `just reset-db` copies `data/bantulex.db` into `backups/` before removing it. Backups contain data and are gitignored. On Linux, `data/` must be writable by uid 1000.

## Credits

Development by [Ghent Centre for Digital Humanities - Ghent University](https://www.ghentcdh.ugent.be/). Funded by the [GhentCDH research projects](https://www.ghentcdh.ugent.be/projects).

<img src="https://www.ghentcdh.ugent.be/ghentcdh_logo_blue_text_transparent_bg_landscape.svg" alt="Landscape" width="500">
