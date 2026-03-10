# BantuLex Local Map

Interactive vector map for BantuLex linguistic data.

## Features
- **MapLibre GL JS**: Smooth vector map rendering.
- **PMTiles**: Local basemap tile archive.
- **Interactive Side Table**: Click map markers to see linguistic entries.

## Project Structure
- `index.html`: Main map interface.
- `data/`: GeoJSON and PMTiles data files.
- `scripts/`:
  - `export_bantulex.py`: Export linguistic data from SQLite to GeoJSON.
  - `download-world-pmtiles.js`: Script to download/extract PMTiles basemaps.
- `Dockerfile`: Caddy-based container for serving the map.

## Maintenance

### Updating Data
To refresh the map markers from the main database:
```sh
uv run python scripts/export_bantulex.py
```

### Changing Map Area
To re-extract the basemap (e.g., if you need a larger area):
```sh
node scripts/download-world-pmtiles.js --bbox=S,W,N,E --output=africa.pmtiles --maxzoom=8
```
(Requires `pmtiles` CLI installed on host or via Go).
