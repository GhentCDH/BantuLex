rebuild:
    docker compose down -t 1
    docker compose up -d --build

up:
    docker compose up -d

import:
    docker compose exec import uv run import

kottster:
    docker compose exec kottster /dev.sh

reinit: rebuild import

reset-db:
    rm -f data/bantulex.db

map-up:
    docker compose up --build -d bantulex-map

map-down:
    docker compose down bantulex-map

map-logs:
    docker compose logs -f bantulex-map

map-rebuild:
    docker compose build --no-cache bantulex-map
    docker compose up -d bantulex-map