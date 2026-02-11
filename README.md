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
- **kottster** — Node.js admin panel for browsing the database (ports 5480/5481)

## Recipes

| Command | Description |
|---------|-------------|
| `just rebuild` | Rebuild and restart all containers |
| `just up` | Start all containers |
| `just import` | Run the data import |
| `just kottster` | Start the Kottster dev server |
| `just reinit` | Rebuild + import |
| `just reset-db` | Delete the SQLite database |


## Credits


Development by [Ghent Centre for Digital Humanities - Ghent University](https://www.ghentcdh.ugent.be/). Funded by the [GhentCDH research projects](https://www.ghentcdh.ugent.be/projects).

<img src="https://www.ghentcdh.ugent.be/ghentcdh_logo_blue_text_transparent_bg_landscape.svg" alt="Landscape" width="500">
