import logging
import io
import contextlib

# Use openpyxl directly to avoid pandas memory overhead
from openpyxl import load_workbook
from rich.logging import RichHandler
from sqlmodel import SQLModel, Session, select

from .config import EXCEL
from .db import create_updated_at_trigger, engine
from .model import Entry, Variety, Location, Source, Fieldwork, SourceEntries, Coordinate

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


def get_or_create(session: Session, model, **kwargs):
    """
    Get an instance of a model with the given kwargs, or create it if it doesn't exist.
    """
    # Construct query
    statement = select(model).filter_by(**kwargs)
    result = session.exec(statement).first()
    if result:
        return result
    
    instance = model(**kwargs)
    session.add(instance)
    session.flush()
    return instance

def clean_value(val):
    if val is None or val == "" or str(val).lower() == "nan":
        return None
    s = str(val).strip()
    return s if s else None

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

    for batch in chunked(rows, batch_size):
        try:
            with Session(engine) as session:
                for i, row_cells in enumerate(batch):
                    row_idx = total_processed + i
                    row = row_to_dict(row_cells, headers)
                    
                    try:
                        # 1. Variety
                        variety_data = {
                            "name_english": clean_value(row.get("Variety (English)")),
                            "name_french": clean_value(row.get("variety (French)")),
                            "name_bantu": clean_value(row.get("Variety (Bantu)")),
                            "name_bastin": clean_value(row.get("Variety as named in Bastin")),
                            "branch": clean_value(row.get("Branch")),
                            "bastin_index": clean_value(row.get("Bastin Index")),
                            "guthrie_index": clean_value(row.get("Guthrie Index")),
                            "guthrie_plus": clean_value(row.get("Guthrie PLUS")),
                        }
                        variety_kwargs = {k: v for k, v in variety_data.items() if v is not None}
                        variety = get_or_create(session, Variety, **variety_kwargs) if variety_kwargs else None

                        # 2. Location
                        location_data = {
                            "place": clean_value(row.get("Place")),
                            "region": clean_value(row.get("Region (fieldwork)")),
                            "country": clean_value(row.get("Country")),
                            "clan": clean_value(row.get("Clan")),
                        }
                        location_kwargs = {k: v for k, v in location_data.items() if v is not None}
                        location = get_or_create(session, Location, **location_kwargs) if location_kwargs else None
                        
                        from .model import Coordinate

                        # Helper to parse floats
                        def parse_float(val):
                            try:
                                return float(val) if val is not None else None
                            except (ValueError, TypeError):
                                return None
                        
                        # Default Coordinates
                        lat = parse_float(row.get("Latitude"))
                        lon = parse_float(row.get("Longitude"))
                        if lat is not None and lon is not None:
                             # Only add coordinate if we have a location
                             if location:
                                 get_or_create(session, Coordinate, location_id=location.id, latitude=lat, longitude=lon, description="default")
                             
                        # Original Coordinates
                        lat_orig = parse_float(row.get("Latitude OR source"))
                        lon_orig = parse_float(row.get("Longitude OR source"))
                        if lat_orig is not None and lon_orig is not None:
                             if location:
                                 get_or_create(session, Coordinate, location_id=location.id, latitude=lat_orig, longitude=lon_orig, description="original")

                        # 3. Fieldwork
                        fieldwork_data = {
                            "project": clean_value(row.get("Project")),
                            "year": clean_value(row.get("Year of collection")), 
                            "data_collectors": clean_value(row.get("Data collector 1")), 
                            "archive": clean_value(row.get("Archive")),
                            "data_entered_by": clean_value(row.get("Data entered by")),
                        }
                        consultant_list = [clean_value(row.get(f"Consultant {j}")) for j in range(1, 5)]
                        consultant_list = [c for c in consultant_list if c]
                        if consultant_list:
                            fieldwork_data["consultants"] = ", ".join(consultant_list)

                        fieldwork_kwargs = {k: v for k, v in fieldwork_data.items() if v is not None}
                        fieldwork = get_or_create(session, Fieldwork, **fieldwork_kwargs) if fieldwork_kwargs else None


                        # 4. Sources
                        def create_source_from_row(prefix=""):
                            author = clean_value(row.get(f"{prefix}Source (Author YEAR)".strip())) or clean_value(row.get(f"{prefix}source".strip())) 
                            
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

                            auth_val = clean_value(row.get(col_auth))
                            title_val = clean_value(row.get(col_title))
                            
                            if not auth_val and not title_val:
                                return None
                                
                            return get_or_create(session, Source, author_year=auth_val, title=title_val)

                        source1 = create_source_from_row("")
                        source2 = create_source_from_row("Second ")
                        cited1 = create_source_from_row("Cited ")
                        cited2 = create_source_from_row("Second cited ")

                        # 5. Entry (Main)
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
                            # logger.warning(f"Row {row_idx}: Skipping entry with no term.")
                            continue

                        entry = Entry(**entry_data)
                        session.add(entry)
                        session.flush() # Need ID for EntrySource

                        # 6. Entry Sources (Citations)
                        if source1:
                            session.add(SourceEntries(entry_id=entry.id, source_id=source1.id, role="primary"))
                        if source2:
                            session.add(SourceEntries(entry_id=entry.id, source_id=source2.id, role="second"))
                        if cited1:
                            session.add(SourceEntries(entry_id=entry.id, source_id=cited1.id, role="cited"))
                        if cited2:
                            session.add(SourceEntries(entry_id=entry.id, source_id=cited2.id, role="second_cited"))
                    
                    except Exception as e:
                        logger.error(f"Error processing row {row_idx}: {e}")
                        # Don't fail the whole chunk, just this row?
                        # But if session is invalidated...
                        # In chunked approach, if one row fails, the whole chunk transaction might be rolled back if we don't savepoint.
                        # session.bind.savepoint() or session.begin_nested()
                        continue

                session.commit()
                total_processed += len(batch)
                logger.info(f"Processed batch ending at row {total_processed}...")
        
        except Exception as e:
            logger.error(f"Error processing batch: {e}")
            continue

    logger.info("Import complete.")

if __name__ == "__main__":
    main()
