KOTTSTER_URL  := "http://localhost:9160"

# ── Docker lifecycle ─────────────────────────────────────────────────────────

rebuild:
    docker compose down -t 1
    docker compose up -d --build

up:
    docker compose up -d

down:
    docker compose down

# ── Import ───────────────────────────────────────────────────────────────────

import:
    docker compose run  -w /app/importer --rm utils  uv run importer

# ── Export (één script per "ding") ───────────────────────────────────────────

# All exports in one command
export: export-evolex export-map export-blr

# Volledig EvoLex Excel-export
export-evolex:
    docker compose run  -w /app/exporter --rm utils  uv run export-evolex
    

# Volledig EvoLex Excel+Google Sheets export
export-evolex-google:
    docker compose run  -w /app/exporter --rm utils  uv run export-evolex-google

# GeoJSON-export van alle taalvariëteiten met coördinaten (voor de kaart)
export-map:
    docker compose run  -w /app/exporter --rm utils  uv run export-map
    cp data/bantulex_entries.geojson local-map/data/

# BLR kaartdata: genereert local-map/data/bantulex_entries.geojson + blr_catalog.json
export-blr:
    docker compose run  -w /app/exporter --rm utils  uv run export-blr
    cp data/blr_catalog.json local-map/data/

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

# ── Data Management (Kottster) ───────────────────────────────────────────────

kottster:
    docker compose exec data-management ./scripts/dev.sh

# ── Database ─────────────────────────────────────────────────────────────────

reset-db:
    rm -f data/bantulex.db*

reinit: rebuild reset-db import map-data

# ── Dev helpers ──────────────────────────────────────────────────────────────

open-admin:
    open "{{KOTTSTER_URL}}/admin"

open:
       open "{{KOTTSTER_URL}}"
