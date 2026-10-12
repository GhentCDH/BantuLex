#!/bin/sh
# Downloads the overview basemap (Protomaps/OpenStreetMap, zoom 0-4, about 6 MB) to the given path,
# default apps/frontend/public/maps/world.pmtiles. Used by the Dockerfile `basemap` stage and by the dev
# container entrypoint when the file is missing. Requires node and the go-pmtiles binary (`pmtiles`).
# Protomaps deletes old daily builds, so the newest key from builds.json is used unless PMTILES_BUILD
# (e.g. 20261011 or 20261011.pmtiles) pins one.
set -e
out="${1:-apps/frontend/public/maps/world.pmtiles}"
build="${PMTILES_BUILD:-$(node -e "fetch('https://build-metadata.protomaps.dev/builds.json').then(r=>{if(!r.ok)throw new Error('builds.json: HTTP '+r.status);return r.json()}).then(b=>console.log(b.map(x=>x.key).sort().at(-1)))")}"
case "$build" in *.pmtiles) ;; *) build="$build.pmtiles" ;; esac
mkdir -p "$(dirname "$out")"
tmp="${out%.pmtiles}.partial.pmtiles"
rm -f "$tmp"
echo "Extracting basemap from https://build.protomaps.com/$build (maxzoom 4) to $out"
pmtiles extract "https://build.protomaps.com/$build" "$tmp" --maxzoom=4
mv "$tmp" "$out"
