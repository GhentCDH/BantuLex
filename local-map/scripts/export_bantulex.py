import sqlite3
import json
import os
from pathlib import Path

def export_to_geojson(db_path, output_path):
    print(f"Connecting to {db_path}...")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Query to get coordinates and associated data
    # This query aggregates entries per variety and location to minimize GeoJSON size
    # but keeps enough detail for the side table.
    query = """
    SELECT 
        c.latitude,
        c.longitude,
        v.id as variety_id,
        v.name_english,
        v.name_bantu,
        v.name_french,
        v.branch,
        v.guthrie_index,
        v.bastin_index,
        v.substrate_suspect,
        p.name as place_name,
        r.name as region_name,
        cnt.name as country_name,
        GROUP_CONCAT(COALESCE(e.term, ''), '||') as terms,
        GROUP_CONCAT(COALESCE(e.translation, ''), '||') as translations,
        GROUP_CONCAT(COALESCE(e.meaning, ''), '||') as meanings,
        GROUP_CONCAT(COALESCE(e.semantic_field, ''), '||') as semantic_fields,
        GROUP_CONCAT(COALESCE(e.part_of_speech, ''), '||') as pos,
        COUNT(e.id) as entry_count
    FROM coordinate c
    JOIN location l ON c.location_id = l.id
    LEFT JOIN place p ON l.place_id = p.id
    LEFT JOIN region r ON l.region_id = r.id
    LEFT JOIN country cnt ON l.country_id = cnt.id
    JOIN entry e ON e.location_id = l.id
    JOIN variety v ON e.variety_id = v.id
    WHERE c.latitude IS NOT NULL 
      AND c.longitude IS NOT NULL 
      AND c.description = 'default'
      AND c.latitude BETWEEN -90 AND 90
      AND c.longitude BETWEEN -180 AND 180
    GROUP BY c.id, v.id
    """

    print("Executing query...")
    cursor.execute(query)
    rows = cursor.fetchall()
    print(f"Found {len(rows)} matching rows.")

    features = []
    for row in rows:
        # Reconstruct list of entries from concatenated strings
        terms = row['terms'].split('||')
        translations = row['translations'].split('||')
        meanings = row['meanings'].split('||')
        sem_fields = row['semantic_fields'].split('||')
        pos_list = row['pos'].split('||')

        entries = []
        for i in range(len(terms)):
            entries.append({
                'term': terms[i],
                'translation': translations[i],
                'meaning': meanings[i],
                'semantic_field': sem_fields[i],
                'pos': pos_list[i]
            })

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [row['longitude'], row['latitude']]
            },
            "properties": {
                "variety_id": row['variety_id'],
                "name": row['name_english'] or row['name_bantu'] or row['name_french'],
                "name_bantu": row['name_bantu'],
                "name_french": row['name_french'],
                "branch": row['branch'],
                "guthrie": row['guthrie_index'],
                "bastin": row['bastin_index'],
                "substrate": bool(row['substrate_suspect']),
                "location": ", ".join(filter(None, [row['place_name'], row['region_name'], row['country_name']])),
                "entry_count": row['entry_count'],
                "entries": entries
            }
        }
        features.append(feature)

    geojson = {
        "type": "FeatureCollection",
        "features": features
    }

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    print(f"Exported {len(features)} features to {output_path}")
    conn.close()

if __name__ == "__main__":
    base_dir = Path(__file__).parent.parent.parent
    db_path = base_dir / "data" / "bantulex.db"
    output_path = base_dir / "local-map" / "data" / "bantulex_entries.geojson"
    
    if not db_path.exists():
        print(f"Error: Database not found at {db_path}")
    else:
        export_to_geojson(db_path, output_path)
