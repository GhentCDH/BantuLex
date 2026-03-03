# syntax=docker/dockerfile:1

# ── base (gedeeld tussen dev en prd) ─────────────────────────────────────────
FROM node:22-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache git tini
RUN npm install

COPY scripts/dev.sh /dev.sh
COPY scripts/prod.sh /prod.sh
RUN chmod +x /dev.sh /prod.sh

EXPOSE 5480
ENV VITE_DOCKER_MODE=true
ENV PORT=5480

# ── development ───────────────────────────────────────────────────────────────
FROM base AS dev
EXPOSE 5481
ENV DEV_API_SERVER_PORT=5481
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["tail", "-f", "/dev/null"]   # origineel gedrag bewaard

# ── production ────────────────────────────────────────────────────────────────
FROM base AS prd

# App-code kopiëren en builden
COPY . .

# KOTTSTER_BASE_PATH is build-time: Vite bakt het pad in de bundle
ARG KOTTSTER_BASE_PATH=""
ENV VITE_BASE_PATH=${KOTTSTER_BASE_PATH}

# Inject basePath into kottster-app.json for the build
RUN apk add --no-cache jq && \
    jq --arg bp "${KOTTSTER_BASE_PATH}" '. + if $bp != "" then {basePath: $bp} else {} end' kottster-app.json > kottster-app.tmp.json && \
    mv kottster-app.tmp.json kottster-app.json

RUN npm run build

# Runtime: pad naar de SQLite database
# Overschrijf met -e DATABASE_PATH=/mnt/samba/bantulex.db in Nomad
ENV DATABASE_PATH=/app/app.db

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/prod.sh"]