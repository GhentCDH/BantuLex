"""
export_blr.py  –  BantuLex DB → kaartdata voor de lokale Klankzoeker

Genereert twee bestanden in local-map/data/:

  bantulex_entries.geojson
      GeoJSON FeatureCollection – één feature per taalvariëteit met gekende
      coördinaten. Elk feature bevat een 'entries'-array met per entry:
        term, translation, meaning, semantic_field,
        blr_index, blr_word, blr_word_tone,
        blr_c1–c4, blr_v11, blr_v12, blr_v21, blr_v22

  blr_catalog.json
      Fonologische index voor de filter-dropdowns in de kaartinterface:
        { consonants: {c1, c2, c3, c4},
          vowels:     {v11, v12, v21, v22},
          entries:    [{blr_index, word, word_tone, english, french,
                        c1–c4, v11–v22, noun_class, distribution, note}] }

Gebruik:
  uv run export-blr
"""

import json
import logging
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set

from rich.logging import RichHandler
from sqlalchemy.orm import joinedload
from sqlmodel import Session, select

from utilities.config import ROOT
from utilities.db import engine
from utilities.model import (
    BLRConsonantStructure, Reconstruction, BLRVowelStructure,
    Reflex, Location, Place, Region, Variety,
)
from utilities.utils import load_default_coords, load_location_by_variety

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

handler = RichHandler(rich_tracebacks=True, markup=True, show_time=True, show_path=True)
logging.basicConfig(level=logging.INFO, format="%(message)s", handlers=[handler])
logger = logging.getLogger(__name__)

MAP_DATA = ROOT / "local-map" / "data"
GEOJSON_OUT = MAP_DATA / "bantulex_entries.geojson"
CATALOG_OUT  = MAP_DATA / "blr_catalog.json"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sorted_unique(values) -> List[str]:
    return sorted(v for v in set(values) if v is not None)


# ---------------------------------------------------------------------------
# GeoJSON builder
# ---------------------------------------------------------------------------

def _build_feature(
    variety: Variety,
    lat: float,
    lon: float,
    entries: List[Reflex],
    blr_by_id: Dict[int, Reconstruction],
    location_name: Optional[str],
) -> Dict[str, Any]:
    entry_list = []
    for e in entries:
        blr = blr_by_id.get(e.blr_entry_id) if e.blr_entry_id else None
        vs = blr.vowel_structure if blr else None
        cs = blr.consonant_structure if blr else None

        entry_list.append({
            "term":           e.term,
            "translation":    e.translation,
            "meaning":        e.meaning,
            "semantic_field": e.semantic_field,
            "pos":            e.part_of_speech,
            # BLR fields (None als geen koppeling)
            "blr_index":      blr.blr_index  if blr else None,
            "blr_word":       blr.word       if blr else None,
            "blr_word_tone":  blr.word_tone  if blr else None,
            "blr_english":    blr.english    if blr else None,
            "blr_french":     blr.french     if blr else None,
            "blr_c1":  cs.c1 if cs else None,
            "blr_c2":  cs.c2 if cs else None,
            "blr_c3":  cs.c3 if cs else None,
            "blr_c4":  cs.c4 if cs else None,
            "blr_cs":  cs.cs if cs else None,
            "blr_v11": vs.v11 if vs else None,
            "blr_v12": vs.v12 if vs else None,
            "blr_v21": vs.v21 if vs else None,
            "blr_v22": vs.v22 if vs else None,
        })

    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [lon, lat],   # GeoJSON: [lng, lat]
        },
        "properties": {
            "variety_id":   variety.id,
            "name":         variety.name_english or variety.name_bantu or variety.name_french or "?",
            "name_bantu":   variety.name_bantu,
            "name_french":  variety.name_french,
            "branch":       variety.branch,
            "guthrie":      variety.guthrie_index,
            "bastin":       variety.bastin_index,
            "substrate":    bool(variety.substrate_suspect),
            "location":     location_name,
            "entry_count":  len(entries),
            "entries":      entry_list,  # Let json.dumps handle the serialization at the end
        },
    }


# ---------------------------------------------------------------------------
# BLR catalog builder
# ---------------------------------------------------------------------------

def _build_catalog(blr_entries: List[Reconstruction]) -> Dict[str, Any]:
    c1s: Set[str] = set()
    c2s: Set[str] = set()
    c3s: Set[str] = set()
    c4s: Set[str] = set()
    v11s: Set[str] = set()
    v12s: Set[str] = set()
    v21s: Set[str] = set()
    v22s: Set[str] = set()

    entries_out = []
    for b in blr_entries:
        cs = b.consonant_structure
        vs = b.vowel_structure

        c1  = cs.c1  if cs else None
        c2  = cs.c2  if cs else None
        c3  = cs.c3  if cs else None
        c4  = cs.c4  if cs else None
        v11 = vs.v11 if vs else None
        v12 = vs.v12 if vs else None
        v21 = vs.v21 if vs else None
        v22 = vs.v22 if vs else None

        if c1:  c1s.add(c1)
        if c2:  c2s.add(c2)
        if c3:  c3s.add(c3)
        if c4:  c4s.add(c4)
        if v11: v11s.add(v11)
        if v12: v12s.add(v12)
        if v21: v21s.add(v21)
        if v22: v22s.add(v22)

        entries_out.append({
            "blr_index":   b.blr_index,
            "word":        b.word,
            "word_tone":   b.word_tone,
            "english":     b.english,
            "french":      b.french,
            "c1": c1, "c2": c2, "c3": c3, "c4": c4,
            "cs": cs.cs if cs else None,
            "v11": v11, "v12": v12, "v21": v21, "v22": v22,
            "v3":  vs.v3  if vs else None,
            "v4":  vs.v4  if vs else None,
            "t11": b.tone_structure.t11 if b.tone_structure else None,
            "t12": b.tone_structure.t12 if b.tone_structure else None,
            "t21": b.tone_structure.t21 if b.tone_structure else None,
            "t22": b.tone_structure.t22 if b.tone_structure else None,
            "noun_class":  b.noun_class,
            "distribution": b.distribution,
            "note":        b.note,
            "proto_kk":    b.proto_kk,
        })

    return {
        "consonants": {
            "c1":  _sorted_unique(c1s),
            "c2":  _sorted_unique(c2s),
            "c3":  _sorted_unique(c3s),
            "c4":  _sorted_unique(c4s),
        },
        "vowels": {
            "v11": _sorted_unique(v11s),
            "v12": _sorted_unique(v12s),
            "v21": _sorted_unique(v21s),
            "v22": _sorted_unique(v22s),
        },
        "entries": sorted(entries_out, key=lambda e: e["blr_index"] or 0),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    logger.info("BantuLex → Klankzoeker kaartdata export gestart…")
    MAP_DATA.mkdir(parents=True, exist_ok=True)

    with Session(engine, expire_on_commit=False) as session:
        entries     = session.exec(select(Reflex)).all()
        varieties   = {v.id: v for v in session.exec(select(Variety)).all()}
        blr_entries = session.exec(
            select(Reconstruction).options(
                joinedload(Reconstruction.vowel_structure),
                joinedload(Reconstruction.consonant_structure),
                joinedload(Reconstruction.tone_structure)
            )
        ).all()
        blr_by_id   = {b.id: b for b in blr_entries}

        coord_by_location = load_default_coords(session)

        # Locatienaam (place of region) per location_id
        locations = {loc.id: loc for loc in session.exec(select(Location)).all()}
        places    = {p.id: p for p in session.exec(select(Place)).all()}
        regions   = {r.id: r for r in session.exec(select(Region)).all()}

        def location_name(loc_id: Optional[int]) -> Optional[str]:
            if loc_id is None:
                return None
            loc = locations.get(loc_id)
            if loc is None:
                return None
            p = places.get(loc.place_id)
            if p and p.name:
                return p.name
            r = regions.get(loc.region_id)
            return r.name if r else None

    # Groepeer entries per variëteit, bewaar ook de locatie-id
    entries_by_variety: Dict[int, List[Reflex]] = defaultdict(list)
    for e in entries:
        if e.variety_id:
            entries_by_variety[e.variety_id].append(e)
    location_by_variety = load_location_by_variety(entries)

    # Bouw GeoJSON features
    features = []
    skipped  = 0
    for variety_id, variety in varieties.items():
        loc_id = location_by_variety.get(variety_id)
        if loc_id is None:
            skipped += 1
            continue
        coords = coord_by_location.get(loc_id)
        if coords is None or None in coords:
            skipped += 1
            continue
        lat, lon = coords
        features.append(_build_feature(
            variety, lat, lon,
            entries_by_variety.get(variety_id, []),
            blr_by_id,
            location_name(loc_id),
        ))

    geojson = {"type": "FeatureCollection", "features": features}
    GEOJSON_OUT.write_text(
        json.dumps(geojson, ensure_ascii=False),
        encoding="utf-8",
    )
    logger.info(f"GeoJSON opgeslagen: {GEOJSON_OUT}  ({len(features)} variëteiten)")
    logger.info(f"  Overgeslagen: {skipped} variëteiten zonder coördinaten")

    # Bouw BLR-catalogus
    catalog = _build_catalog(blr_entries)
    CATALOG_OUT.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    linked = sum(1 for e in entries if e.blr_entry_id is not None)
    logger.info(f"Catalogus opgeslagen: {CATALOG_OUT}  ({len(catalog['entries'])} BLR-entries)")
    logger.info(f"  BantuLex-entries met BLR-koppeling: {linked} / {len(entries)}")
