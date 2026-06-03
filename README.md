# BantuLex

Linguistic data management system for Bantu languages. Imports data from Excel (via CSV export) into an SQLite database, with a Kottster admin panel for browsing.

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- [just](https://github.com/casey/just) (optional, for convenience recipes)

## Quick Start

```sh
just reinit
```

This will build the containers, run the import, and set up the database.

## Services

- **import** — Python/uv container for importing CSV data into SQLite
- **bantulex-map** — MapLibre-based static vector map (port 80 via proxy)
- **caddy** — Reverse proxy for all services

## Recipes

| Command            | Description                        |
| ------------------ | ---------------------------------- |
| `just rebuild`     | Rebuild and restart all containers |
| `just up`          | Start all containers               |
| `just import`      | Run the data import                |
| `just map-up`      | Build and start the map service    |
| `just map-rebuild` | Force rebuild of the map service   |
| `just reinit`      | Rebuild + import                   |
| `just reset-db`    | Delete the SQLite database         |

## Credits

Development by [Ghent Centre for Digital Humanities - Ghent University](https://www.ghentcdh.ugent.be/). Funded by the [GhentCDH research projects](https://www.ghentcdh.ugent.be/projects).

<img src="https://www.ghentcdh.ugent.be/ghentcdh_logo_blue_text_transparent_bg_landscape.svg" alt="Landscape" width="500">
