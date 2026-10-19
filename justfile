
# Pihka-publicatie: bron-export, gebouwde site en rsync-doel (bv. user@server:/srv/bantulex/)
PIHKA_URL     := "http://localhost:9161"
SOURCE_DB     := env("BANTULEX_SOURCE_DB", "out/export.sqlite")
DIST          := "dist/bantulex"
DEPLOY_TARGET := env("BANTULEX_DEPLOY_TARGET", "")

# Crouton URL
ADMIN_URL := "http://localhost:4444/admin/"

# ── Docker lifecycle ─────────────────────────────────────────────────────────

# Het admin-profiel staat bewust niet in `up`/`rebuild`: de admin heeft data/bantulex.db nodig.
rebuild:
    docker compose --profile admin down -t 1
    docker compose up -d --build

up:
    docker compose up -d

down:
    docker compose --profile admin down

# ── Modelgeneratie ───────────────────────────────────────────────────────────

generate-diagram:
    docker compose run -w /app/utils/documenter --rm utils uv run document

# ── Import ───────────────────────────────────────────────────────────────────

# Optioneel een ander bestand in data/: just import "BantuLex_20261008.xlsx"
import file="bantulex.xlsx":
    docker compose run -e EXCEL_FILE="{{file}}" -w /app/utils/importer --rm utils uv run importer

# ── Export (één script per "ding") ───────────────────────────────────────────

# Volledig EvoLex Excel-export
export-evolex:
    docker compose run  -w /app/utils/exporter --rm utils  uv run export-evolex
    

# GeoJSON-export van alle taalvariëteiten met coördinaten (voor de kaart)
export-map:
    docker compose run  -w /app/utils/exporter --rm utils  uv run export-map

# BLR kaartdata: genereert data/bantulex_entries.geojson + data/blr_catalog.json
export-blr:
    docker compose run  -w /app/utils/exporter --rm utils  uv run export-blr

# Alle exports in één keer
export-all: export-evolex export-map export-blr

# ── Publicatie (Pihka) ───────────────────────────────────────────────────────
# vendor/pihka is een git submodule van GhentCDH/Pihka en wordt nooit lokaal aangepast.
# site/ is de eigen BantuLex-UI; van Pihka gebruikt die alleen core/ (engine) en de kaartextensie.

# Kopieert de SQLite-export naar site/database en materialiseert de perspectieven uit site/config.json
site-db:
    cp {{SOURCE_DB}} site/database/bantulex.sqlite
    node --input-type=module -e "import { readFileSync } from 'node:fs'; \
      import { prepareSampleDatabase } from './vendor/pihka/scripts/prepare-sample-db.js'; \
      await prepareSampleDatabase('site/database/bantulex.sqlite', JSON.parse(readFileSync('site/config.json', 'utf8')));"

# Lokale Pihka op {{PIHKA_URL}}, site/ is live gemount (herlaad de browser na wijzigingen)
pihka-up:
    docker compose up -d pihka

# Voegt site/ en de gebruikte delen van Pihka samen tot één statische map
build-site:
    rm -rf {{DIST}}
    mkdir -p {{DIST}}/extensions
    cp -r site/. {{DIST}}/
    cp -r vendor/pihka/pihka/core {{DIST}}/core
    cp -r vendor/pihka/pihka/extensions/point_map {{DIST}}/extensions/point_map
    rm -f {{DIST}}/database/.gitkeep

# Kopieert de gebouwde site naar de Caddy-server
publish: build-site
    @test -n "{{DEPLOY_TARGET}}" || (echo "Zet BANTULEX_DEPLOY_TARGET, bv. user@server:/srv/bantulex/" && exit 1)
    rsync -av --delete --delay-updates {{DIST}}/ {{DEPLOY_TARGET}}

# Haalt de vastgezette Pihka-versie op (na clone of checkout)
pihka-init:
    git submodule update --init vendor/pihka

# Zet vendor/pihka op de nieuwste Pihka main; commit daarna de nieuwe submodule-pointer
pihka-update:
    git submodule update --init --remote vendor/pihka
    git -C vendor/pihka log --oneline -1

# ── Data Management (Crouton admin, zie admin/README.md) ─────────────────────

# Productie-image bouwen en starten op :4444 (vereist data/bantulex.db, schrijfbaar voor uid 1000)
admin:
    mkdir -p backups
    docker compose --profile admin up -d --build admin

# Dev-server met hot reload (UI :5555/admin/, API :4444/api); stop eerst `admin` (zelfde poort 4444)
admin-dev:
    cd admin && docker compose --profile dev up dev

# Typecheck, build en unit/integratietests in de dev-container
admin-test:
    cd admin && docker compose run --rm dev sh -c "pnpm typecheck && pnpm build && pnpm test"

# Start eerst Chrome met --remote-debugging-port=9222, zie admin/README.md
# Browsertests: Playwright in de container stuurt de Chrome op de host aan via CDP
admin-e2e:
    cd admin && docker compose --profile dev run --rm --service-ports e2e

# ── Database ─────────────────────────────────────────────────────────────────

# Verwijdert data/bantulex.db na een kopie naar backups/ (de admin werkt op hetzelfde bestand)
reset-db:
    mkdir -p backups
    if [ -f data/bantulex.db ]; then cp data/bantulex.db "backups/bantulex_$(date +%Y%m%d_%H%M%S).db"; fi
    rm -f data/bantulex.db data/bantulex.db-journal

reinit: rebuild reset-db import

# ── Dev helpers ──────────────────────────────────────────────────────────────

open-admin:
    open "{{ADMIN_URL}}"

