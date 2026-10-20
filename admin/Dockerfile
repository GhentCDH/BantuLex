# syntax=docker/dockerfile:1
# BantuLex: NestJS/Crouton API on /api and the built Vue UI on /admin/, in one container.
# The SQLite database is not part of the image: mount a directory containing bantulex.db at /app/data.
# `docker build .` produces the runtime image (last stage). The `dev` stage is the toolchain used by the
# compose `dev` service for pnpm dev, typecheck, build and tests; it is skipped when building the runtime image.
# The basemap (apps/frontend/public/maps/world.pmtiles) is not in git: it is extracted from the newest
# Protomaps daily build at image build time (`--build-arg PMTILES_BUILD=YYYYMMDD` pins a build).

# go-pmtiles is a distroless image without a shell; only its static binary and CA bundle are used.
FROM ghcr.io/protomaps/go-pmtiles:v1.31.2 AS pmtiles

FROM node:24.21.0-trixie-slim AS dev
# Nx state stays out of the mounted project: its task tracker is keyed by PID, which repeats across containers.
ENV CI=true NX_DAEMON=false NX_NO_CLOUD=true \
    NX_WORKSPACE_DATA_DIRECTORY=/tmp/nx-workspace-data NX_CACHE_DIRECTORY=/app/node_modules/.cache/nx \
    npm_config_store_dir=/app/node_modules/.pnpm-store pnpm_config_store_dir=/app/node_modules/.pnpm-store
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@11.9.0 --activate
# The entrypoint downloads the basemap into the mounted project when it is missing.
COPY --from=pmtiles /go-pmtiles /usr/local/bin/pmtiles
COPY --from=pmtiles /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY scripts/docker-dev-entrypoint.sh /usr/local/bin/docker-dev-entrypoint
WORKDIR /app
ENTRYPOINT ["docker-dev-entrypoint"]
CMD ["pnpm", "dev"]

# The basemap is platform-independent data: download it natively, not under QEMU in multi-arch builds.
FROM --platform=$BUILDPLATFORM ghcr.io/protomaps/go-pmtiles:v1.31.2 AS pmtiles-native
FROM --platform=$BUILDPLATFORM node:24.21.0-trixie-slim AS basemap
ARG PMTILES_BUILD=
COPY --from=pmtiles-native /go-pmtiles /usr/local/bin/pmtiles
COPY --from=pmtiles-native /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY scripts/fetch-basemap.sh /usr/local/bin/fetch-basemap
RUN PMTILES_BUILD="$PMTILES_BUILD" fetch-basemap /maps/world.pmtiles

FROM node:24.21.0-trixie-slim AS build
WORKDIR /app
ENV NX_DAEMON=false NX_NO_CLOUD=true NX_SKIP_NX_CACHE=true CI=true
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
# The store lives in the same layer filesystem so pnpm hard-links instead of copying (smaller build).
RUN pnpm install --frozen-lockfile
COPY crouton.json nx.json tsconfig.json ./
COPY prisma ./prisma
COPY apps ./apps
COPY --from=basemap /maps/world.pmtiles ./apps/frontend/public/maps/world.pmtiles
# Generates the Prisma client and Zod types (no database access), then builds backend and frontend.
RUN pnpm run setup && pnpm build
# Production-only dependencies; the Crouton patches are re-applied in case pruning relinked packages.
RUN pnpm prune --prod --ignore-scripts && node scripts/patch-crouton.mjs

FROM node:24.21.0-trixie-slim AS runtime
# tini forwards signals for a clean shutdown.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4444 \
    DATABASE_PATH=/app/data/bantulex.db \
    CROUTON_SCHEMA_EDITOR=false
COPY --from=build /app/package.json /app/crouton.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 4444
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4444)+'/api/country?pageSize=1').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/backend/main.js"]
