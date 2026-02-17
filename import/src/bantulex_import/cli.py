import logging
import pandas as pd
from rich.logging import RichHandler
from sqlmodel import SQLModel, Session, select

from .config import EXCEL
from .db import create_updated_at_trigger, engine
from .model import Entry, Variety, Location, Source, Fieldwork

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
    Note: Ideally this should check for existing records based on unique constraints.
    For now, we'll try to find one with matching fields.
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
    if pd.isna(val) or val == "" or val == "nan":
        return None
    return str(val).strip()

def main():
    SQLModel.metadata.create_all(engine)
    create_updated_at_trigger(engine)

    if not EXCEL.exists():
        logger.warning(f"Excel file not found at {EXCEL}, skipping import.")
        return

    logger.info(f"Reading Excel file: {EXCEL}")
    
    # Read limited rows for testing
    limit = 50 
    logger.info(f"Limiting to first {limit} rows for testing.")
    
    df = pd.read_excel(EXCEL, nrows=limit, dtype=str)
    
    logger.info(f"Columns found: {list(df.columns)}")

    with Session(engine) as session:
        for i, row in df.iterrows():
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
                variety = get_or_create(session, Variety, **{k: v for k, v in variety_data.items() if v is not None})

                # 2. Location
                location_data = {
                    "place": clean_value(row.get("Place")),
                    "region": clean_value(row.get("Region (fieldwork)")),
                    "country": clean_value(row.get("Country")),
                    "clan": clean_value(row.get("Clan")),
                    "longitude_source": clean_value(row.get("Longitude OR source")),
                    "latitude_source": clean_value(row.get("Latitude OR source")),
                }
                
                # Handle floats safely
                try:
                    lon = row.get("Longitude")
                    location_data["longitude"] = float(lon) if not pd.isna(lon) else None
                except (ValueError, TypeError):
                    location_data["longitude"] = None
                    
                try:
                    lat = row.get("Latitude")
                    location_data["latitude"] = float(lat) if not pd.isna(lat) else None
                except (ValueError, TypeError):
                    location_data["latitude"] = None

                location = get_or_create(session, Location, **{k: v for k, v in location_data.items() if v is not None})

                # 3. Fieldwork
                fieldwork_data = {
                    "project": clean_value(row.get("Project")),
                    "year": clean_value(row.get("Year of collection")), # or "Source Fieldwork (data collector YEAR)"?
                    "data_collectors": clean_value(row.get("Data collector 1")), # + 2?
                    "archive": clean_value(row.get("Archive")),
                    "data_entered_by": clean_value(row.get("Data entered by")),
                }
                consultant_list = [clean_value(row.get(f"Consultant {j}")) for j in range(1, 5)]
                consultant_list = [c for c in consultant_list if c]
                if consultant_list:
                    fieldwork_data["consultants"] = ", ".join(consultant_list)

                fieldwork = get_or_create(session, Fieldwork, **{k: v for k, v in fieldwork_data.items() if v is not None})


                # 4. Sources
                def create_source_from_row(prefix=""):
                    author = clean_value(row.get(f"{prefix}Source (Author YEAR)".strip())) or clean_value(row.get(f"{prefix}source".strip())) # Handle naming variations?
                    # The headers are tricky: "Source (Author YEAR)", "Second source (Author Year)", "Cited source", "Second cited source"
                    
                    # Specific mapping based on header analysis
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
                    "source_id": source1.id if source1 else None,
                    "second_source_id": source2.id if source2 else None,
                    "cited_source_id": cited1.id if cited1 else None,
                    "second_cited_source_id": cited2.id if cited2 else None,
                }

                # IDs
                try:
                   oid = row.get("ID 20250825")
                   entry_data["original_id"] = int(oid) if not pd.isna(oid) else None
                except: pass
                
                try:
                   bid = row.get("ID beginning")
                   entry_data["beginning_id"] = int(bid) if not pd.isna(bid) else None
                except: pass

                entry = Entry(**entry_data)
                session.add(entry)

                if i % 10 == 0:
                    logger.info(f"Processed row {i}...")
            
            except Exception as e:
                logger.error(f"Error processing row {i}: {e}")
                continue

        session.commit()
    
    logger.info("Import complete.")

if __name__ == "__main__":
    main()
