"""
export_map.py  –  BantuLex DB → GeoJSON export voor kaartweergave

Elke taalvariëteit met gekende coördinaten wordt een GeoJSON Feature:
  geometry   : Point [lon, lat]
  properties : name_english, branch, guthrie_index, entry_count

Output: /data/bantulex_map.geojson  (overschrijft bij elke run)

Gebruik:
  uv run export-map
"""

import json
import logging
from collections import Counter
from typing import Any, Dict, List

from rich.logging import RichHandler
from sqlmodel import Session, select

from utilities.config import ROOT
from utilities.db import engine
from utilities.model import Entry, Variety
from utilities.utils import load_default_coords, load_location_by_variety

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

handler = RichHandler(rich_tracebacks=True, markup=True, show_time=True, show_path=True)
logging.basicConfig(level=logging.INFO, format="%(message)s", handlers=[handler])
logger = logging.getLogger(__name__)

OUTPUT = ROOT / "data" / "bantulex_map.geojson"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_feature(variety: Variety, lat: float, lon: float, count: int) -> Dict[str, Any]:
    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [lon, lat],  # GeoJSON: [longitude, latitude]
        },
        "properties": {
            "id":            variety.id,
            "name":          variety.name_english,
            "branch":        variety.branch,
            "guthrie_index": variety.guthrie_index,
            "guthrie_plus":  variety.guthrie_plus,
            "entry_count":   count,
        },
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    logger.info("BantuLex → GeoJSON map export gestart…")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    with Session(engine, expire_on_commit=False) as session:
        # Count entries per variety
        entries = session.exec(select(Entry)).all()
        count_by_variety: Counter = Counter(
            e.variety_id for e in entries if e.variety_id is not None
        )

        coord_by_location = load_default_coords(session)
        location_by_variety = load_location_by_variety(entries)

        varieties = session.exec(select(Variety)).all()

        features: List[Dict[str, Any]] = []
        skipped = 0
        for v in varieties:
            loc_id = location_by_variety.get(v.id)
            if loc_id is None:
                skipped += 1
                continue
            coords = coord_by_location.get(loc_id)
            if coords is None or None in coords:
                skipped += 1
                continue
            lat, lon = coords
            features.append(_build_feature(v, lat, lon, count_by_variety.get(v.id, 0)))

    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }

    OUTPUT.write_text(json.dumps(geojson, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info(f"Opgeslagen: {OUTPUT}")
    logger.info(f"  Features:  {len(features)} taalvariëteiten met coördinaten")
    logger.info(f"  Overgeslagen: {skipped} variëteiten zonder locatie")


if __name__ == "__main__":
    main()
