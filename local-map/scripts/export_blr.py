"""
export_blr.py
=============
Exports two data files for the EvoLex map:

1. data/bantulex_entries.geojson
   Same format as export_bantulex.py, but EACH entry object now also carries
   BLR fields (blr_index, blr_word, blr_c1…c4, blr_v11…v22) when a BLR link
   exists.  Backward-compatible: the old index.html still works unchanged.

2. data/blr_catalog.json
   A compact phonological catalogue used to populate the EvoLex filter
   dropdowns.  Structure:
   {
     "consonants": { "c1": [...], "c2": [...], "c3": [...], "c4": [...] },
     "vowels":     { "v11": [...], "v12": [...], "v21": [...], "v22": [...] },
     "entries": [
       {
         "blr_index": 42,
         "word": "...", "word_tone": "...",
         "english": "...", "french": "...",
         "noun_class": "...", "distribution": "...", "note": "...",
         "c1": "p", "c2": "t", "c3": "", "c4": "", "cs": "CVC",
         "v11": "a", "v12": "", "v21": "a", "v22": "", "v3": "", "v4": "",
         "entry_count": 7,
         "variety_count": 5
       }, ...
     ]
   }

Usage:
    python scripts/export_evolex.py [path/to/bantulex.db]

If no path is given, the script looks for data/bantulex.db relative to the
repository root (two levels above this file).
"""

import sqlite3
import json
import os
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def split_col(value, sep="||"):
    """Split a GROUP_CONCAT column into a list; always returns list of str."""
    if not value:
        return []
    return value.split(sep)


def to_int_or_none(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# GeoJSON export (BantuLex entries + BLR phonological fields per entry)
# ---------------------------------------------------------------------------

GEOJSON_QUERY = """
SELECT
    c.latitude,
    c.longitude,
    v.id                   AS variety_id,
    v.name_english,
    v.name_bantu,
    v.name_french,
    v.branch,
    v.guthrie_index,
    v.bastin_index,
    v.substrate_suspect,
    p.name                 AS place_name,
    r.name                 AS region_name,
    cnt.name               AS country_name,

    -- BantuLex entry fields
    GROUP_CONCAT(COALESCE(e.term,           ''), '||') AS terms,
    GROUP_CONCAT(COALESCE(e.translation,    ''), '||') AS translations,
    GROUP_CONCAT(COALESCE(e.meaning,        ''), '||') AS meanings,
    GROUP_CONCAT(COALESCE(e.semantic_field, ''), '||') AS semantic_fields,
    GROUP_CONCAT(COALESCE(e.part_of_speech, ''), '||') AS pos,

    -- BLR link per entry
    GROUP_CONCAT(COALESCE(CAST(be.blr_index AS TEXT), ''), '||') AS blr_indices,
    GROUP_CONCAT(COALESCE(be.word,       ''), '||') AS blr_words,
    GROUP_CONCAT(COALESCE(be.word_tone,  ''), '||') AS blr_word_tones,
    GROUP_CONCAT(COALESCE(be.english,    ''), '||') AS blr_englishes,
    GROUP_CONCAT(COALESCE(be.french,     ''), '||') AS blr_frenchs,

    -- Consonant structure per BLR entry
    GROUP_CONCAT(COALESCE(cs.c1,  ''), '||') AS blr_c1s,
    GROUP_CONCAT(COALESCE(cs.c2,  ''), '||') AS blr_c2s,
    GROUP_CONCAT(COALESCE(cs.c3,  ''), '||') AS blr_c3s,
    GROUP_CONCAT(COALESCE(cs.c4,  ''), '||') AS blr_c4s,
    GROUP_CONCAT(COALESCE(cs.cs,  ''), '||') AS blr_css,

    -- Vowel structure per BLR entry
    GROUP_CONCAT(COALESCE(vs.v11, ''), '||') AS blr_v11s,
    GROUP_CONCAT(COALESCE(vs.v12, ''), '||') AS blr_v12s,
    GROUP_CONCAT(COALESCE(vs.v21, ''), '||') AS blr_v21s,
    GROUP_CONCAT(COALESCE(vs.v22, ''), '||') AS blr_v22s,

    COUNT(e.id) AS entry_count

FROM coordinate c
JOIN   location  l   ON  c.location_id  = l.id
LEFT JOIN place      p   ON  l.place_id     = p.id
LEFT JOIN region     r   ON  l.region_id    = r.id
LEFT JOIN country    cnt ON  l.country_id   = cnt.id
JOIN   entry     e   ON  e.location_id  = l.id
JOIN   variety   v   ON  e.variety_id   = v.id
LEFT JOIN blrentry              be  ON  e.blr_entry_id          = be.id
LEFT JOIN blrconsonantstructure cs  ON  be.consonant_structure_id = cs.id
LEFT JOIN blrvowelstructure     vs  ON  be.vowel_structure_id     = vs.id

WHERE c.latitude  IS NOT NULL
  AND c.longitude IS NOT NULL
  AND c.description = 'default'
  AND c.latitude  BETWEEN -90  AND 90
  AND c.longitude BETWEEN -180 AND 180

GROUP BY c.id, v.id
"""


def export_geojson(cursor, output_path):
    print("Exporting GeoJSON with BLR fields …")
    cursor.execute(GEOJSON_QUERY)
    rows = cursor.fetchall()
    print(f"  {len(rows)} (coordinate × variety) rows found.")

    features = []
    for row in rows:
        n = row["entry_count"]

        def col(key):
            return split_col(row[key]) if row[key] else [""] * n

        entries = []
        for i in range(n):
            blr_idx = to_int_or_none(col("blr_indices")[i]) if i < len(col("blr_indices")) else None
            entry = {
                "term":           col("terms")[i]          if i < len(col("terms"))          else "",
                "translation":    col("translations")[i]   if i < len(col("translations"))   else "",
                "meaning":        col("meanings")[i]       if i < len(col("meanings"))       else "",
                "semantic_field": col("semantic_fields")[i] if i < len(col("semantic_fields")) else "",
                "pos":            col("pos")[i]            if i < len(col("pos"))            else "",
                # BLR fields (empty string when no link)
                "blr_index":      blr_idx,
                "blr_word":       col("blr_words")[i]      if i < len(col("blr_words"))      else "",
                "blr_word_tone":  col("blr_word_tones")[i] if i < len(col("blr_word_tones")) else "",
                "blr_english":    col("blr_englishes")[i]  if i < len(col("blr_englishes"))  else "",
                "blr_french":     col("blr_frenchs")[i]    if i < len(col("blr_frenchs"))    else "",
                "blr_c1":         col("blr_c1s")[i]        if i < len(col("blr_c1s"))        else "",
                "blr_c2":         col("blr_c2s")[i]        if i < len(col("blr_c2s"))        else "",
                "blr_c3":         col("blr_c3s")[i]        if i < len(col("blr_c3s"))        else "",
                "blr_c4":         col("blr_c4s")[i]        if i < len(col("blr_c4s"))        else "",
                "blr_cs":         col("blr_css")[i]        if i < len(col("blr_css"))        else "",
                "blr_v11":        col("blr_v11s")[i]       if i < len(col("blr_v11s"))       else "",
                "blr_v12":        col("blr_v12s")[i]       if i < len(col("blr_v12s"))       else "",
                "blr_v21":        col("blr_v21s")[i]       if i < len(col("blr_v21s"))       else "",
                "blr_v22":        col("blr_v22s")[i]       if i < len(col("blr_v22s"))       else "",
            }
            entries.append(entry)

        name = (row["name_english"] or row["name_bantu"] or row["name_french"] or "?")
        location = ", ".join(filter(None, [row["place_name"], row["region_name"], row["country_name"]]))

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [row["longitude"], row["latitude"]]
            },
            "properties": {
                "variety_id":  row["variety_id"],
                "name":        name,
                "name_bantu":  row["name_bantu"],
                "name_french": row["name_french"],
                "branch":      row["branch"],
                "guthrie":     row["guthrie_index"],
                "bastin":      row["bastin_index"],
                "substrate":   bool(row["substrate_suspect"]),
                "location":    location,
                "entry_count": row["entry_count"],
                "entries":     entries,
            }
        }
        features.append(feature)

    geojson = {"type": "FeatureCollection", "features": features}
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)
    print(f"  → {output_path}  ({len(features)} features)")


# ---------------------------------------------------------------------------
# BLR catalogue export (for EvoLex filter dropdowns)
# ---------------------------------------------------------------------------

CATALOG_QUERY = """
SELECT
    be.id              AS db_id,
    be.blr_index,
    be.word,
    be.word_tone,
    be.english,
    be.french,
    be.noun_class,
    be.distribution,
    be.note,
    be.proto_kk,
    cs.c1,  cs.c2,  cs.c3,  cs.c4,  cs.cs,
    vs.v11, vs.v12, vs.v21, vs.v22, vs.v3, vs.v4,
    ts.t11, ts.t12, ts.t21, ts.t22,
    COUNT(DISTINCT e.id)  AS entry_count,
    COUNT(DISTINCT v.id)  AS variety_count
FROM blrentry be
JOIN entry   e  ON e.blr_entry_id          = be.id
JOIN variety v  ON e.variety_id            = v.id
LEFT JOIN blrconsonantstructure cs ON be.consonant_structure_id = cs.id
LEFT JOIN blrvowelstructure     vs ON be.vowel_structure_id     = vs.id
LEFT JOIN blrtonestructure      ts ON be.tone_structure_id      = ts.id
GROUP BY be.id
ORDER BY be.blr_index
"""


def _unique_sorted(values):
    """Return sorted unique non-empty values."""
    return sorted({v for v in values if v})


def export_catalog(cursor, output_path):
    print("Exporting BLR catalogue …")
    cursor.execute(CATALOG_QUERY)
    rows = cursor.fetchall()
    print(f"  {len(rows)} BLR entries with at least one BantuLex link found.")

    entries = []
    c1s, c2s, c3s, c4s = [], [], [], []
    v11s, v12s, v21s, v22s = [], [], [], []

    for row in rows:
        entry = {
            "blr_index":    row["blr_index"],
            "word":         row["word"]      or "",
            "word_tone":    row["word_tone"] or "",
            "english":      row["english"]   or "",
            "french":       row["french"]    or "",
            "noun_class":   row["noun_class"]   or "",
            "distribution": row["distribution"] or "",
            "note":         row["note"]      or "",
            "proto_kk":     row["proto_kk"]  or "",
            "c1":  row["c1"]  or "", "c2":  row["c2"]  or "",
            "c3":  row["c3"]  or "", "c4":  row["c4"]  or "",
            "cs":  row["cs"]  or "",
            "v11": row["v11"] or "", "v12": row["v12"] or "",
            "v21": row["v21"] or "", "v22": row["v22"] or "",
            "v3":  row["v3"]  or "", "v4":  row["v4"]  or "",
            "t11": row["t11"] or "", "t12": row["t12"] or "",
            "t21": row["t21"] or "", "t22": row["t22"] or "",
            "entry_count":   row["entry_count"],
            "variety_count": row["variety_count"],
        }
        entries.append(entry)
        c1s.append(row["c1"] or ""); c2s.append(row["c2"] or "")
        c3s.append(row["c3"] or ""); c4s.append(row["c4"] or "")
        v11s.append(row["v11"] or ""); v12s.append(row["v12"] or "")
        v21s.append(row["v21"] or ""); v22s.append(row["v22"] or "")

    catalog = {
        "consonants": {
            "c1": _unique_sorted(c1s),
            "c2": _unique_sorted(c2s),
            "c3": _unique_sorted(c3s),
            "c4": _unique_sorted(c4s),
        },
        "vowels": {
            "v11": _unique_sorted(v11s),
            "v12": _unique_sorted(v12s),
            "v21": _unique_sorted(v21s),
            "v22": _unique_sorted(v22s),
        },
        "entries": entries,
    }

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
    print(f"  → {output_path}  ({len(entries)} BLR entries)")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) > 1:
        db_path = Path(sys.argv[1])
    else:
        # Default: <repo root>/data/bantulex.db
        # Path(__file__) is <repo root>/local-map/scripts/export_blr.py
        # parents[2] is <repo root>
        db_path = Path(__file__).resolve().parents[2] / "data" / "bantulex.db"

    if not db_path.exists():
        print(f"ERROR: database not found at {db_path}")
        print("Usage: python scripts/export_blr.py [path/to/bantulex.db]")
        sys.exit(1)

    base_dir = Path(__file__).resolve().parents[2]
    geojson_out = base_dir / "local-map" / "data" / "bantulex_entries.geojson"
    catalog_out = base_dir / "local-map" / "data" / "blr_catalog.json"

    print(f"Database : {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    export_geojson(cursor, str(geojson_out))
    export_catalog(cursor, str(catalog_out))

    conn.close()
    print("\nDone. Run evolex.html in a local server to use the EvoLex map.")


if __name__ == "__main__":
    main()