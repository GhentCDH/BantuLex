# BantuLex Local Map

Interactive vector map for BantuLex linguistic data, with an integrated BLR sound search (Klankzoeker).

## Features
- **MapLibre GL JS**: Smooth vector map rendering.
- **PMTiles**: Local basemap tile archive.
- **BantuLex tab**: Click map markers to see linguistic entries per variety.
- **Klankzoeker tab**: Filter on BLR phonological features (C1–C4, V₁₁–V₂₂) to find matching varieties on the map.

## Project Structure
- `index.html`: The map interface, including the Klankzoeker tab.
- `data/` (generated, gitignored):
  - `bantulex_entries.geojson`: Linguistic data per variety, with BLR fields.
  - `blr_catalog.json`: BLR phonological index for the Klankzoeker.
  - `world.pmtiles`: Protomaps basemap.

Caddy (`gateway` service) serves this directory on http://localhost:9160 (`just open`).

## Maintenance

Run from the repository root:

```sh
just export-blr   # data/bantulex_entries.geojson + data/blr_catalog.json
just export-map   # data/bantulex_entries.geojson only (without BLR fields)
just map-data     # data/world.pmtiles (Protomaps, maxzoom 6)
```

`export-blr` and `export-map` both write `bantulex_entries.geojson`; run `export-blr` last (as `just export-all` does) to keep the BLR fields.
