KOTTSTER_URL  := "http://localhost:9160"

# ── Docker lifecycle ─────────────────────────────────────────────────────────

rebuild:
    docker compose down -t 1
    docker compose up -d --build

up:
    docker compose up -d

down:
    docker compose down

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
    

# Volledig EvoLex Excel+Google Sheets export
export-evolex-google:
    docker compose run  -w /app/utils/exporter --rm utils  uv run export-evolex-google

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

# ── Data Management (Kottster) ───────────────────────────────────────────────

kottster:
    docker compose exec data-management ./scripts/dev.sh

# ── Database ─────────────────────────────────────────────────────────────────

reset-db:
    docker compose up -d postgres
    docker compose exec -T postgres psql -U bantulex -d postgres -c "DROP DATABASE IF EXISTS bantulex WITH (FORCE);"
    docker compose exec -T postgres psql -U bantulex -d postgres -c "CREATE DATABASE bantulex OWNER bantulex;"

# Drop everything owned by the bantulex role (importer tables, removed-from-model tables, sequences, etc.)
# Safe on remote DB: Mathesar's objects are owned by mathesar_bantulex, untouched.
reset-tables:
    docker compose run --rm utils uv run python -c \
    "from sqlalchemy import text; from utilities.db import engine; \
     conn = engine.connect(); conn.execute(text('DROP OWNED BY bantulex CASCADE')); conn.commit(); \
     print('dropped all objects owned by bantulex')"

# (Re)grant Mathesar role access on importer-owned objects + set default privs for future tables.
# Needed after every reset-tables/import since DROP OWNED BY clears default privileges too.
grant-mathesar:
    docker compose run --rm utils uv run python -c \
    "from sqlalchemy import text; from utilities.db import engine; \
     stmts = [ \
       'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO mathesar_bantulex', \
       'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO mathesar_bantulex', \
       'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO mathesar_bantulex', \
       'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO mathesar_bantulex', \
     ]; \
     conn = engine.connect(); \
     [conn.execute(text(s)) for s in stmts]; conn.commit(); \
     print('granted mathesar_bantulex on bantulex objects')"

reinit: rebuild reset-db import map-data

# Remote-safe reinit: keep DB + Mathesar objects, recreate only importer-owned objects
reinit-remote: reset-tables import grant-mathesar

# ── Dev helpers ──────────────────────────────────────────────────────────────

open-admin:
    open "{{KOTTSTER_URL}}/admin"

open:
       open "{{KOTTSTER_URL}}"
