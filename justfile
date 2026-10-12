MAP_URL   := "http://localhost:9160"
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

import:
    docker compose run -w /app/utils/importer --rm utils uv run importer

# ── Export (één script per "ding") ───────────────────────────────────────────

# Volledig EvoLex Excel-export
export-evolex:
    docker compose run  -w /app/utils/exporter --rm utils  uv run export-evolex
    

# GeoJSON-export van alle taalvariëteiten met coördinaten (voor de kaart)
export-map:
    docker compose run  -w /app/utils/exporter --rm utils  uv run export-map
    cp data/bantulex_entries.geojson local-map/data/

# BLR kaartdata: genereert local-map/data/bantulex_entries.geojson + blr_catalog.json
export-blr:
    docker compose run  -w /app/utils/exporter --rm utils  uv run export-blr
    cp data/blr_catalog.json local-map/data/
    cp data/bantulex_entries.geojson local-map/data/

# Alle exports in één keer
export-all: export-evolex export-map export-blr

# ── Kaartdata (pmtiles) ──────────────────────────────────────────────────────
# Haalt de nieuwste Protomaps world op en zet die in ./local-map/data/
map-data:
    mkdir -p local-map/data
    docker run --rm \
        -v "$(pwd)/local-map/data:/out" \
        ghcr.io/protomaps/go-pmtiles:latest extract \
        "https://build.protomaps.com/$(curl -s https://build-metadata.protomaps.dev/builds.json | \
          node -e "const b=require('fs').readFileSync('/dev/stdin','utf8');\
          console.log(JSON.parse(b).sort((a,b)=>b.key<a.key?-1:1)[0].key)")" \
        /out/world.pmtiles \
        --maxzoom=6

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

reset-db:
    docker compose up -d postgres
    docker compose exec -T postgres psql -U bantulex -d postgres -c "DROP DATABASE IF EXISTS bantulex WITH (FORCE);"
    docker compose exec -T postgres psql -U bantulex -d postgres -c "CREATE DATABASE bantulex OWNER bantulex;"

reinit: rebuild reset-db import map-data

# ── Dev helpers ──────────────────────────────────────────────────────────────

open-admin:
    open "{{ADMIN_URL}}"

open:
    open "{{MAP_URL}}"

