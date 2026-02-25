KOTTSTER_HOST := "localhost"
KOTTSTER_PORT := "5480"
KOTTSTER_PATH := "/admin"
KOTTSTER_URL := "http://{{KOTTSTER_HOST}}:{{KOTTSTER_PORT}}{{KOTTSTER_PATH}}"

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

open:
    KOTTSTER_HOST=localhost \
    KOTTSTER_PORT=5480 \
    KOTTSTER_PATH=/admin \
    KOTTSTER_URL="http://$KOTTSTER_HOST:$KOTTSTER_PORT$KOTTSTER_PATH" && \
    echo "Waiting for $KOTTSTER_URL..." && \
    until nc -z "$KOTTSTER_HOST" "$KOTTSTER_PORT"; do \
      echo -n "."; \
      sleep 0.5; \
    done && \
    echo "" && \
    echo "$KOTTSTER_URL ready!" && \
    if [ "{{os()}}" = "macos" ]; then \
      open "$KOTTSTER_URL"; \
    elif [ "{{os()}}" = "linux" ]; then \
      xdg-open "$KOTTSTER_URL"; \
    else \
      start "$KOTTSTER_URL"; \
    fi
