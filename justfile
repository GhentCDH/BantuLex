KOTTSTER_HOST := "localhost"
KOTTSTER_PORT := "5480"
KOTTSTER_PATH := "/bantulex/admin"
KOTTSTER_URL := "http://{{KOTTSTER_HOST}}:{{KOTTSTER_PORT}}{{KOTTSTER_PATH}}"

rebuild:
    docker compose down -t 1
    docker compose up -d --build

up:
    docker compose up -d

import:
	docker compose exec import uv run import
	docker compose exec kottster rm -rf /app/.cache
	docker compose restart kottster

export:
    docker compose exec export uv run export

export-blr:
    docker compose exec export uv run export-blr

kottster:
    docker compose exec kottster ./scripts/dev.sh

reset-db:
    rm -f data/bantulex.db*

map-up:
    docker compose up --build -d bantulex-map

map-data:
    just --justfile local-map/justfile --working-directory local-map export-blr
    docker run --rm \
        -v "$(pwd)/local-map/data:/usr/share/caddy/data" \
        bantulex-bantulex-map pmtiles extract \
        "https://build.protomaps.com/$(curl -s https://build-metadata.protomaps.dev/builds.json | node -e "const b=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(b).sort((a,b)=>b.key<a.key?-1:1)[0].key)")" \
        /usr/share/caddy/data/africa.pmtiles \
        --bbox=-18,-35,52,38 \
        --maxzoom=8

reinit: rebuild import map-data map-up

open:
    @echo "Waiting for {{KOTTSTER_URL}}..."
    @until nc -z {{KOTTSTER_HOST}} {{KOTTSTER_PORT}}; do \
      printf "."; sleep 0.5; \
    done
    @echo "\n{{KOTTSTER_URL}} ready!"
    @if [ "{{os()}}" = "macos" ]; then \
      open "{{KOTTSTER_URL}}"; \
    elif [ "{{os()}}" = "linux" ]; then \
      xdg-open "{{KOTTSTER_URL}}"; \
    else \
      start "{{KOTTSTER_URL}}"; \
    fi
