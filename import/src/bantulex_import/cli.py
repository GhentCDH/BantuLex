import logging
import io
import contextlib
import re
from datetime import datetime
from typing import Dict, Tuple, Optional, Any, List

# Use openpyxl directly to avoid pandas memory overhead
from openpyxl import load_workbook
from rich.logging import RichHandler
from sqlmodel import SQLModel, Session, select

from .config import EXCEL
from .db import create_updated_at_trigger, engine
from .model import Entry, Variety, Location, Source, Fieldwork, SourceEntries, Coordinate, Country, Region, Place

handler = RichHandler(
    rich_tracebacks=True,
    tracebacks_show_locals=True,
    markup=True,
    show_time=True,
    show_path=True,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    handlers=[handler],
)

logger = logging.getLogger(__name__)


def clean_value(val):
    if val is None or val == "" or str(val).lower() == "nan":
        return None
    s = str(val).strip()
    return s if s else None

class ImportReport:
    def __init__(self):
        # category -> list of dictionaries
        self.categories: Dict[str, List[Dict[str, Any]]] = {}
    
    def add(self, category, data: Dict[str, Any]):
        if category not in self.categories:
            self.categories[category] = []
        self.categories[category].append(data)
    
    def save(self, path):
        from openpyxl import Workbook
        wb = Workbook()
        # Remove default sheet
        default_sheet = wb.active
        if default_sheet:
            wb.remove(default_sheet)

        for category in sorted(self.categories.keys()):
            # Create a sheet for each category
            # Sheet names are limited to 31 chars
            ws_name = category.upper()[:31]
            ws = wb.create_sheet(title=ws_name)
            
            entries = self.categories[category]
            if not entries:
                continue
                
            # Headers from first entry keys
            headers = list(entries[0].keys())
            ws.append(headers)
            
            # Sort by 'Row' if present
            if "Row" in headers:
                entries = sorted(entries, key=lambda x: x["Row"])
            
            for entry in entries:
                ws.append([entry.get(h, "") for h in headers])

        wb.save(path)

def parse_uncertainty(val):
    if not val:
        return None, False
    
    s = str(val).strip()
    if s == "?????":
        return None, True
    
    is_uncertain = False
    if "?" in s:
        is_uncertain = True
        import re
        s = re.sub(r"\s*\(?\?\)?\s*", "", s).strip()
    
    return s if s else None, is_uncertain

def main():
    SQLModel.metadata.create_all(engine)
    create_updated_at_trigger(engine)

    if not EXCEL.exists():
        logger.warning(f"Excel file not found at {EXCEL}, skipping import.")
        return

    logger.info(f"Reading Excel file: {EXCEL} with openpyxl (read_only=True)")
    
    # Load workbook in read-only mode for memory efficiency
    wb = load_workbook(EXCEL, read_only=True, data_only=True)
    ws = wb.active
    
    # Get headers
    rows = ws.rows
    print(f"Total amount of rows: {ws.max_row}")
    print(f"Name of WS: {ws.title}")
    
    try:
        header_row = next(rows)
    except StopIteration:
        logger.error("Empty Excel file")
        return

    headers = [str(cell.value).strip() if cell.value is not None else None for cell in header_row]
    
    logger.info(f"Columns found: {headers}")

    # Helper to mimic pandas row access
    def row_to_dict(row_cells, headers):
        return {h: cell.value for h, cell in zip(headers, row_cells) if h is not None}

    # Batch process rows
    from itertools import islice

    def chunked(iterable, n):
        it = iter(iterable)
        while True:
            chunk = list(islice(it, n))
            if not chunk:
                return
            yield chunk

    total_processed = 0
    batch_size = 1000
    import_report = ImportReport()

    # Local Caches to avoid repeated DB Lookups
    # Keys should be tuples of defining attributes
    varieties_cache: Dict[Tuple, Variety] = {}
    countries_cache: Dict[str, Country] = {}
    regions_cache: Dict[Tuple[str, Optional[int]], Region] = {} # (name, country_id)
    places_cache: Dict[Tuple[str, Optional[int]], Place] = {} # (name, region_id)
    locations_cache: Dict[Tuple, Location] = {}
    sources_cache: Dict[Tuple, Source] = {}
    fieldworks_cache: Dict[Tuple, Fieldwork] = {}
    # Track location coordinates to find mismatches: location_id -> description -> (lat, lon, original_row_idx)
    location_coordinates_tracking: Dict[int, Dict[str, Tuple[float, float, int]]] = {}
    
    with Session(engine, expire_on_commit=False) as session:
        logger.info("Pre-loading caches from database...")
        for v in session.exec(select(Variety)).all():
            key = (v.name_english, v.name_french, v.name_bantu, v.name_bastin, v.branch, v.bastin_index, v.guthrie_index, v.guthrie_plus)
            varieties_cache[key] = v
        
        for c in session.exec(select(Country)).all():
            if c.name: countries_cache[c.name] = c
            
        for r in session.exec(select(Region)).all():
            if r.name: regions_cache[(r.name, r.country_id)] = r
            
        for p in session.exec(select(Place)).all():
            if p.name: places_cache[(p.name, p.region_id)] = p

        for l in session.exec(select(Location)).all():
            key = (l.place_id, l.region_id, l.country_id, l.clan)
            locations_cache[key] = l

        for s in session.exec(select(Source)).all():
            key = (s.author_year, s.title)
            sources_cache[key] = s
            
        for f in session.exec(select(Fieldwork)).all():
            key = (f.project, f.year, f.consultants, f.data_collectors, f.archive, f.data_entered_by)
            fieldworks_cache[key] = f

        logger.info("Caches pre-loaded.")

        # Process all rows in chunks but keep the same session
        for batch in chunked(rows, batch_size):
            try:
                for i, row_cells in enumerate(batch):
                    row_idx = total_processed + i
                    row = row_to_dict(row_cells, headers)
                    
                    try:
                        # 1. Variety
                        v_data = (
                            clean_value(row.get("Variety (English)")),
                            clean_value(row.get("variety (French)")),
                            clean_value(row.get("Variety (Bantu)")),
                            clean_value(row.get("Variety as named in Bastin")),
                            clean_value(row.get("Branch")),
                            clean_value(row.get("Bastin Index")),
                            clean_value(row.get("Guthrie Index")),
                            clean_value(row.get("Guthrie PLUS")),
                        )
                        variety = None
                        if any(v_data):
                            if v_data in varieties_cache:
                                variety = varieties_cache[v_data]
                            else:
                                variety = Variety(
                                    name_english=v_data[0], name_french=v_data[1], name_bantu=v_data[2],
                                    name_bastin=v_data[3], branch=v_data[4], bastin_index=v_data[5],
                                    guthrie_index=v_data[6], guthrie_plus=v_data[7]
                                )
                                session.add(variety)
                                session.flush()
                                varieties_cache[v_data] = variety

                        # 2. Location Hierarchy
                        # Country
                        country_val = clean_value(row.get("Country"))
                        country = None
                        if country_val:
                            if country_val in countries_cache:
                                country = countries_cache[country_val]
                            else:
                                country = Country(name=country_val)
                                session.add(country)
                                session.flush()
                                countries_cache[country_val] = country
                        
                        # Region
                        region_val = clean_value(row.get("Region (fieldwork)"))
                        region = None
                        if region_val:
                            r_key = (region_val, country.id if country else None)
                            if r_key in regions_cache:
                                region = regions_cache[r_key]
                            else:
                                region = Region(name=region_val, country_id=country.id if country else None)
                                session.add(region)
                                session.flush()
                                regions_cache[r_key] = region

                        # Place
                        place_val = clean_value(row.get("Place"))
                        place = None
                        if place_val:
                            p_key = (place_val, region.id if region else None)
                            if p_key in places_cache:
                                place = places_cache[p_key]
                            else:
                                place = Place(name=place_val, region_id=region.id if region else None)
                                session.add(place)
                                session.flush()
                                places_cache[p_key] = place

                        # Location
                        clan_val = clean_value(row.get("Clan"))
                        l_key = (
                            place.id if place else None,
                            region.id if region else None,
                            country.id if country else None,
                            clan_val
                        )
                        
                        location = None
                        if any(l_key):
                            if l_key in locations_cache:
                                location = locations_cache[l_key]
                            else:
                                location = Location(
                                    place_id=l_key[0],
                                    region_id=l_key[1],
                                    country_id=l_key[2],
                                    clan=l_key[3]
                                )
                                session.add(location)
                                session.flush()
                                locations_cache[l_key] = location

                        # Coordinates
                        def parse_float(val):
                            try:
                                return float(val) if val is not None else None
                            except (ValueError, TypeError):
                                return None
                        
                        def add_coordinate(loc_id, lat, lon, desc):
                            excel_row = total_processed + i + 2
                            if loc_id not in location_coordinates_tracking:
                                location_coordinates_tracking[loc_id] = {}
                            
                            if desc not in location_coordinates_tracking[loc_id]:
                                session.add(Coordinate(location_id=loc_id, latitude=lat, longitude=lon, description=desc))
                                location_coordinates_tracking[loc_id][desc] = (lat, lon, excel_row)
                            else:
                                existing_lat, existing_lon, conflicting_row = location_coordinates_tracking[loc_id][desc]
                                # Only log if the new coordinates actually differ
                                if lat != existing_lat or lon != existing_lon:
                                    term = clean_value(row.get("Term"))
                                    variety = clean_value(row.get("Variety"))
                                    import_report.add("coordinate conflict", {
                                        "Row": excel_row,
                                        "Type": desc,
                                        "Existing Lat": existing_lat,
                                        "Existing Lon": existing_lon,
                                        "New Lat": lat,
                                        "New Lon": lon,
                                        "Term": term,
                                        "Variety": variety,
                                        "Conflicting Row": conflicting_row
                                    })

                        lat_def = parse_float(row.get("Latitude"))
                        lon_def = parse_float(row.get("Longitude"))
                        if lat_def is not None and lon_def is not None and location:
                             add_coordinate(location.id, lat_def, lon_def, "default")
                             
                        lat_orig = parse_float(row.get("Latitude OR source"))
                        lon_orig = parse_float(row.get("Longitude OR source"))
                        if lat_orig is not None and lon_orig is not None and location:
                             add_coordinate(location.id, lat_orig, lon_orig, "original")

                        # 3. Fieldwork
                        f_project = clean_value(row.get("Project"))
                        f_year_col = "Year of collection"
                        f_year_raw = clean_value(row.get(f_year_col))
                        f_year, f_uncertain = parse_uncertainty(f_year_raw)
                        
                        if f_uncertain:
                            excel_row = total_processed + i + 2
                            import_report.add("uncertainty", {
                                "Row": excel_row,
                                "Column": f_year_col,
                                "Original Value": f_year_raw,
                                "Cleaned Value": f_year
                            })

                        f_data_collectors = clean_value(row.get("Data collector 1"))
                        f_archive = clean_value(row.get("Archive"))
                        f_entered_by = clean_value(row.get("Data entered by"))
                        
                        consultant_list = [clean_value(row.get(f"Consultant {j}")) for j in range(1, 5)]
                        consultant_list = [c for c in consultant_list if c]
                        f_consultants = ", ".join(consultant_list) if consultant_list else None
                        
                        f_key = (f_project, f_year, f_consultants, f_data_collectors, f_archive, f_entered_by)
                        
                        fieldwork = None
                        if any(f_key):
                            if f_key in fieldworks_cache:
                                fieldwork = fieldworks_cache[f_key]
                            else:
                                fieldwork = Fieldwork(
                                    project=f_project, year=f_year, year_uncertain=f_uncertain,
                                    consultants=f_consultants,
                                    data_collectors=f_data_collectors, archive=f_archive, data_entered_by=f_entered_by
                                )
                                session.add(fieldwork)
                                session.flush()
                                fieldworks_cache[f_key] = fieldwork


                        # 4. Sources
                        def get_source(prefix=""):
                            if prefix == "":
                                col_auth = "Source (Author YEAR)"
                                col_title = "Title"
                            elif prefix == "Second ":
                                col_auth = "Second source (Author Year)"
                                col_title = "Title second source"
                            elif prefix == "Cited ":
                                col_auth = "Cited source"
                                col_title = "Title cited source"
                            elif prefix == "Second cited ":
                                col_auth = "Second cited source"
                                col_title = "Title second cited source"
                            else:
                                return None

                            auth_col = col_auth
                            auth_val_raw = clean_value(row.get(auth_col))
                            if prefix == "" and not auth_val_raw:
                                auth_col = "source"
                                auth_val_raw = clean_value(row.get(auth_col))

                            title_val = clean_value(row.get(col_title))
                            if not auth_val_raw and not title_val:
                                return None
                            
                            auth_val, s_uncertain = parse_uncertainty(auth_val_raw)
                            if s_uncertain:
                                excel_row = total_processed + i + 2
                                import_report.add("uncertainty", {
                                    "Row": excel_row,
                                    "Column": auth_col,
                                    "Original Value": auth_val_raw,
                                    "Cleaned Value": auth_val
                                })

                            s_key = (auth_val, title_val)
                            if s_key in sources_cache:
                                return sources_cache[s_key]
                            else:
                                src = Source(author_year=auth_val, year_uncertain=s_uncertain, title=title_val)
                                session.add(src)
                                session.flush()
                                sources_cache[s_key] = src
                                return src

                        source1 = get_source("")
                        source2 = get_source("Second ")
                        cited1 = get_source("Cited ")
                        cited2 = get_source("Second cited ")

                        # 5. Entry
                        entry_data = {
                            "term": clean_value(row.get("Term")),
                            "term_morph_analysis": clean_value(row.get("Term with Morphological Analysis")),
                            "translation": clean_value(row.get("Translation")),
                            "meaning": clean_value(row.get("Meaning")),
                            "scientific_name": clean_value(row.get("Scientific name")),
                            "semantic_field": clean_value(row.get("Semantic field")),
                            "part_of_speech": clean_value(row.get("Part of Speech")),
                            "ipa": clean_value(row.get("IPA")),
                            "notes": clean_value(row.get("Opmerking")) or clean_value(row.get("Notes")),
                            
                            "variety_id": variety.id if variety else None,
                            "location_id": location.id if location else None,
                            "fieldwork_id": fieldwork.id if fieldwork else None,
                        }

                        # IDs
                        try:
                           oid = row.get("ID 20250825")
                           entry_data["original_id"] = int(oid) if oid is not None else None
                        except: pass
                        
                        try:
                           bid = row.get("ID beginning")
                           entry_data["beginning_id"] = int(bid) if bid is not None else None
                        except: pass

                        if not entry_data.get("term"):
                            continue

                        entry = Entry(**entry_data)
                        session.add(entry)
                        session.flush() 

                        # 6. Entry Sources
                        if source1:
                            session.add(SourceEntries(entry_id=entry.id, source_id=source1.id, role="primary"))
                        if source2:
                            session.add(SourceEntries(entry_id=entry.id, source_id=source2.id, role="second"))
                        if cited1:
                            session.add(SourceEntries(entry_id=entry.id, source_id=cited1.id, role="cited"))
                        if cited2:
                            session.add(SourceEntries(entry_id=entry.id, source_id=cited2.id, role="second_cited"))
                    
                    except Exception as e:
                        excel_row = total_processed + i + 2
                        logger.error(f"Error processing Excel row {excel_row}: {e}")
                        import_report.add("critical error", {
                            "Row": excel_row,
                            "Column": None,
                            "Error Message": str(e)
                        })
                        continue

                session.commit()
                total_processed += len(batch)
                logger.info(f"Processed batch ending at row {total_processed}...")
        
            except Exception as e:
                logger.error(f"Error processing batch: {e}")
                session.rollback()
                continue


    logger.info("Import complete.")
    report_path = "import_validation.xlsx"
    import_report.save(report_path)
    logger.info(f"Validation report saved to {report_path}")

if __name__ == "__main__":
    main()
