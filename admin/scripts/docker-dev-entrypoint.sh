#!/bin/sh
# Dev container entrypoint: keep the Linux node_modules volume in sync with the lockfile
# (a no-op when nothing changed; postinstall re-applies the Crouton patches), generate the Prisma client
# into that volume, download the basemap if it is missing (it is not in git), then run the command.
set -e
pnpm install --frozen-lockfile
pnpm run setup >/dev/null
[ -s apps/frontend/public/maps/world.pmtiles ] || sh scripts/fetch-basemap.sh apps/frontend/public/maps/world.pmtiles
exec "$@"
