import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import load_workbook
from rich.logging import RichHandler
from sqlmodel import SQLModel, Session, select

from .config import EXCEL
from .db import create_updated_at_trigger, engine
from .model import (
    CollectionYear, Coordinate, Country, DataCollector, Entry,
    Fieldwork, FieldworkDataCollector, Location, Place, Project,
    Region, Source, SourceEntries, Variety,
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

handler = RichHandler(
    rich_tracebacks=True,
    tracebacks_show_locals=True,
    markup=True,
    show_time=True,
    show_path=True,
)
logging.basicConfig(level=logging.INFO, format="%(message)s", handlers=[handler])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def clean_value(val: Any) -> Optional[str]:
    if val is None or val == "" or str(val).lower() == "nan":
        return None
    s = str(val).strip()
    return s if s else None


def parse_float(val: Any) -> Optional[float]:
    try:
        return float(val) if val is not None else None
    except (ValueError, TypeError):
        return None


def parse_int(val: Any) -> Tuple[Optional[int], bool]:
    """Returns (parsed_int_or_None, success_bool)."""
    if val is None:
        return None, True
    try:
        return int(val), True
    except (ValueError, TypeError):
        return None, False


def parse_uncertainty(val: Any) -> Tuple[Optional[str], bool]:
    """
    Strip uncertainty markers; return (cleaned_value, is_uncertain).

    Examples:
      "?????" or "???"           -> (None,                      True)
      "Bouka 1989?"              -> ("Bouka 1989",              True)
      "Crine 1981 (?)"           -> ("Crine 1981",              True)
      "Daeleman 1975 (or 1976?)" -> ("Daeleman 1975 (or 1976)", True)
        Alternative year is preserved to avoid data loss.
        These entries are flagged in the report for manual review.
    """
    if not val:
        return None, False
    s = str(val).strip()
    if re.fullmatch(r"\?+", s):
        return None, True
    if "?" not in s:
        return s, False
    # Remove standalone (?) marker but preserve other parenthetical content
    cleaned = re.sub(r"\s*\(\?\)\s*", " ", s).strip()
    cleaned = re.sub(r"(?<!\()\?(?!\))", "", cleaned).strip()
    return (cleaned if cleaned else None), True


# ---------------------------------------------------------------------------
# Import Report
# ---------------------------------------------------------------------------

class ImportReport:
    """Writes a structured multi-sheet Excel validation report."""

    CATEGORIES = (
        "uncertainty",
        "fallback_used",
        "value_normalized",
        "invalid_format",
        "duplicate_beginning_id",
        "coordinate_conflict",
        "critical_error",
    )

    def __init__(self) -> None:
        self.categories: Dict[str, List[Dict[str, Any]]] = {
            c: [] for c in self.CATEGORIES
        }

    def add(self, category: str, data: Dict[str, Any]) -> None:
        self.categories.setdefault(category, []).append(data)

    def save(self, path: str) -> None:
        from openpyxl import Workbook
        wb = Workbook()
        if wb.active:
            wb.remove(wb.active)
        for category in self.CATEGORIES:
            entries = self.categories.get(category, [])
            ws = wb.create_sheet(title=category.upper()[:31])
            if not entries:
                ws.append(["(no entries)"])
                continue
            headers = list(entries[0].keys())
            ws.append(headers)
            for entry in sorted(entries, key=lambda x: x.get("Row", 0)):
                ws.append([entry.get(h, "") for h in headers])
        wb.save(path)


# ---------------------------------------------------------------------------
# Generic get-or-create
# ---------------------------------------------------------------------------

def get_or_create(cache: dict, key: tuple, factory, session) -> Any:
    """
    Return cached ORM object for *key*, or create/persist/cache a new one
    via factory(). Returns None when all key components are None.
    """
    if all(k is None for k in key):
        return None
    if key in cache:
        return cache[key]
    obj = factory()
    session.add(obj)
    session.flush()
    cache[key] = obj
    return obj


# ---------------------------------------------------------------------------
# Chunked iteration
# ---------------------------------------------------------------------------

def _chunked(iterable, n: int):
    from itertools import islice
    it = iter(iterable)
    while True:
        chunk = list(islice(it, n))
        if not chunk:
            return
        yield chunk


# ---------------------------------------------------------------------------
# Main import
# ---------------------------------------------------------------------------

def main() -> None:
    SQLModel.metadata.create_all(engine)
    create_updated_at_trigger(engine)

    if not EXCEL.exists():
        logger.warning(f"Excel file not found at {EXCEL}"); return

    logger.info(f"Reading: {EXCEL}")
    wb = load_workbook(EXCEL, read_only=True, data_only=True)
    ws = wb.active
    logger.info(f"Worksheet: '{ws.title}' | rows (approx): {ws.max_row}")

    rows = ws.rows
    try:
        header_row = next(rows)
    except StopIteration:
        logger.error("Empty Excel file."); return

    headers = [
        str(c.value).strip() if c.value is not None else None
        for c in header_row
    ]
    logger.info(f"Columns: {[h for h in headers if h]}")

    def row_to_dict(rc) -> dict:
        return {h: c.value for h, c in zip(headers, rc) if h is not None}

    # -----------------------------------------------------------------------
    # In-memory caches (key -> ORM object)
    # -----------------------------------------------------------------------
    varieties_cache:       Dict[tuple, Variety]         = {}
    countries_cache:       Dict[tuple, Country]         = {}
    regions_cache:         Dict[tuple, Region]          = {}
    places_cache:          Dict[tuple, Place]           = {}
    locations_cache:       Dict[tuple, Location]        = {}
    sources_cache:         Dict[tuple, Source]          = {}
    projects_cache:        Dict[tuple, Project]         = {}
    years_cache:           Dict[tuple, CollectionYear]  = {}
    data_collectors_cache: Dict[tuple, DataCollector]   = {}
    fieldworks_cache:      Dict[tuple, Fieldwork]       = {}

    # (location_id, description) -> (lat, lon, excel_row) for conflict detection
    coord_seen: Dict[Tuple[int, str], Tuple[float, float, int]] = {}
    seen_beginning_ids: set = set()
    import_report = ImportReport()
    total_processed = 0

    with Session(engine, expire_on_commit=False) as session:

        # -------------------------------------------------------------------
        # Pre-load caches from existing DB rows
        # -------------------------------------------------------------------
        logger.info("Pre-loading caches from database...")

        for v in session.exec(select(Variety)).all():
            k = (v.name_english, v.name_french, v.name_bantu, v.name_bastin,
                 v.branch, v.bastin_index, v.guthrie_index, v.guthrie_plus)
            varieties_cache[k] = v
        for c in session.exec(select(Country)).all():
            if c.name: countries_cache[(c.name,)] = c
        for r in session.exec(select(Region)).all():
            if r.name: regions_cache[(r.name, r.country_id)] = r
        for p in session.exec(select(Place)).all():
            if p.name: places_cache[(p.name, p.region_id)] = p
        for loc in session.exec(select(Location)).all():
            locations_cache[(loc.place_id, loc.region_id, loc.country_id)] = loc
        for s in session.exec(select(Source)).all():
            sources_cache[(s.author_year, s.title)] = s
        for proj in session.exec(select(Project)).all():
            if proj.name: projects_cache[(proj.name,)] = proj
        for cy in session.exec(select(CollectionYear)).all():
            years_cache[(cy.value, cy.status)] = cy
        for dc in session.exec(select(DataCollector)).all():
            if dc.name: data_collectors_cache[(dc.name,)] = dc
        for fw in session.exec(select(Fieldwork)).all():
            dc_ids = tuple(sorted(
                lnk.data_collector_id for lnk in session.exec(
                    select(FieldworkDataCollector).where(
                        FieldworkDataCollector.fieldwork_id == fw.id
                    )
                ).all()
            ))
            k = (fw.project_id, fw.collection_year_id,
                 fw.consultants, fw.archive, fw.data_entered_by, dc_ids)
            fieldworks_cache[k] = fw

        logger.info("Caches pre-loaded.")

        # -------------------------------------------------------------------
        # Row processing
        # -------------------------------------------------------------------
        for batch in _chunked(rows, 1000):
            try:
                for i, row_cells in enumerate(batch):
                    excel_row = total_processed + i + 2
                    row = row_to_dict(row_cells)
                    try:

                        # 1. Variety
                        v_key = (
                            clean_value(row.get("Variety (English)")),
                            clean_value(row.get("variety (French)")),
                            clean_value(row.get("Variety (Bantu)")),
                            clean_value(row.get("Variety as named in Bastin")),
                            clean_value(row.get("Branch")),
                            clean_value(row.get("Bastin Index")),
                            clean_value(row.get("Guthrie Index")),
                            clean_value(row.get("Guthrie PLUS")),
                        )
                        variety = get_or_create(
                            varieties_cache, v_key,
                            lambda k=v_key: Variety(
                                name_english=k[0], name_french=k[1],
                                name_bantu=k[2], name_bastin=k[3],
                                branch=k[4], bastin_index=k[5],
                                guthrie_index=k[6], guthrie_plus=k[7],
                            ), session)

                        # 2. Location hierarchy (clan excluded per project decision)
                        country_val = clean_value(row.get("Country"))
                        country = get_or_create(
                            countries_cache, (country_val,),
                            lambda n=country_val: Country(name=n),
                            session) if country_val else None

                        region_val = clean_value(row.get("Region (fieldwork)"))
                        r_key = (region_val, country.id if country else None)
                        region = get_or_create(
                            regions_cache, r_key,
                            lambda k=r_key: Region(name=k[0], country_id=k[1]),
                            session) if region_val else None

                        place_val = clean_value(row.get("Place"))
                        p_key = (place_val, region.id if region else None)
                        place = get_or_create(
                            places_cache, p_key,
                            lambda k=p_key: Place(name=k[0], region_id=k[1]),
                            session) if place_val else None

                        loc_key = (
                            place.id if place else None,
                            region.id if region else None,
                            country.id if country else None,
                        )
                        location = get_or_create(
                            locations_cache, loc_key,
                            lambda k=loc_key: Location(
                                place_id=k[0], region_id=k[1], country_id=k[2]),
                            session)

                        # 3. Coordinates (BK/BL primary; BM/BN as fallback)
                        lat_def = parse_float(row.get("Latitude"))
                        lon_def = parse_float(row.get("Longitude"))
                        lat_src = parse_float(row.get("Latitude OR source"))
                        lon_src = parse_float(row.get("Longitude OR source"))

                        if (lat_def is None or lon_def is None) \
                                and lat_src is not None and lon_src is not None:
                            lat_def, lon_def = lat_src, lon_src
                            import_report.add("fallback_used", {
                                "Row": excel_row,
                                "Note": "BK/BL empty; copied from BM/BN (OR source)",
                                "Lat used": lat_def,
                                "Lon used": lon_def,
                            })

                        def _add_coord(lat: float, lon: float, desc: str) -> None:
                            if location is None:
                                return
                            tk = (location.id, desc)
                            if tk not in coord_seen:
                                session.add(Coordinate(
                                    location_id=location.id,
                                    latitude=lat, longitude=lon, description=desc))
                                coord_seen[tk] = (lat, lon, excel_row)
                            else:
                                ex_lat, ex_lon, ex_row = coord_seen[tk]
                                if lat != ex_lat or lon != ex_lon:
                                    import_report.add("coordinate_conflict", {
                                        "Row": excel_row, "Type": desc,
                                        "Existing Lat": ex_lat, "Existing Lon": ex_lon,
                                        "New Lat": lat, "New Lon": lon,
                                        "Term": clean_value(row.get("Term")),
                                        "Conflicting Row": ex_row,
                                    })

                        if lat_def is not None and lon_def is not None:
                            _add_coord(lat_def, lon_def, "default")
                        if lat_src is not None and lon_src is not None:
                            _add_coord(lat_src, lon_src, "original")

                        # 4. Fieldwork

                        # 4a. Project
                        project_val = clean_value(row.get("Project"))
                        project = get_or_create(
                            projects_cache, (project_val,),
                            lambda n=project_val: Project(name=n),
                            session) if project_val else None

                        # 4b. Collection year
                        f_year_raw = clean_value(row.get("Year of collection"))
                        collection_year = None
                        if f_year_raw is not None:
                            f_year_val, f_unc = parse_uncertainty(f_year_raw)
                            if f_year_val is None:
                                year_status = "unknown"
                            elif f_unc:
                                year_status = "uncertain"
                            else:
                                year_status = "known"

                            if f_unc:
                                import_report.add("uncertainty", {
                                    "Row": excel_row,
                                    "Column": "Year of collection",
                                    "Original Value": f_year_raw,
                                    "Cleaned Value": f_year_val,
                                    "Status": year_status,
                                    "Note": "Year uncertain; review if alternative year present.",
                                })

                            year_key = (f_year_val, year_status)
                            collection_year = get_or_create(
                                years_cache, year_key,
                                lambda k=year_key: CollectionYear(value=k[0], status=k[1]),
                                session)

                        # 4c. Data collectors (one record per person)
                        dc_names = list(filter(None, [
                            clean_value(row.get(f"Data collector {j}"))
                            for j in range(1, 3)
                        ]))
                        dc_objects = [
                            get_or_create(
                                data_collectors_cache, (name,),
                                lambda n=name: DataCollector(name=n),
                                session)
                            for name in dc_names
                        ]

                        # 4d. Fieldwork
                        consultants = ", ".join(filter(None, [
                            clean_value(row.get(f"Consultant {j}"))
                            for j in range(1, 5)
                        ])) or None
                        archive_val = clean_value(row.get("Archive"))
                        entered_by  = clean_value(row.get("Data entered by"))
                        dc_id_tuple = tuple(sorted(dc.id for dc in dc_objects))

                        f_key = (
                            project.id if project else None,
                            collection_year.id if collection_year else None,
                            consultants,
                            archive_val,
                            entered_by,
                            dc_id_tuple,
                        )
                        fieldwork = None
                        if any(k is not None for k in f_key):
                            if f_key in fieldworks_cache:
                                fieldwork = fieldworks_cache[f_key]
                            else:
                                fieldwork = Fieldwork(
                                    project_id=project.id if project else None,
                                    collection_year_id=collection_year.id if collection_year else None,
                                    consultants=consultants,
                                    archive=archive_val,
                                    data_entered_by=entered_by,
                                )
                                session.add(fieldwork)
                                session.flush()
                                for dc in dc_objects:
                                    session.add(FieldworkDataCollector(
                                        fieldwork_id=fieldwork.id,
                                        data_collector_id=dc.id,
                                    ))
                                fieldworks_cache[f_key] = fieldwork

                        # 5. Sources
                        def _get_source(auth_col: str, title_col: str, pages_col: str) -> Optional[Source]:
                            auth_raw  = clean_value(row.get(auth_col))
                            title_val = clean_value(row.get(title_col))
                            pages_val = clean_value(row.get(pages_col))
                            if not auth_raw and not title_val:
                                return None, None
                            auth_val, unc = parse_uncertainty(auth_raw)
                            if unc:
                                import_report.add("uncertainty", {
                                    "Row": excel_row, "Column": auth_col,
                                    "Original Value": auth_raw,
                                    "Cleaned Value": auth_val,
                                    "Note": "Uncertain year; check for alternative if present.",
                                })
                            s_key = (auth_val, title_val)
                            source = get_or_create(
                                sources_cache, s_key,
                                lambda k=s_key, u=unc: Source(
                                    author_year=k[0], year_uncertain=u, title=k[1]),
                                session)
                            return source, pages_val

                        src1, pages1  = _get_source("Source (Author YEAR)", "Title", "Page number")
                        src2, pages2  = _get_source("Second source (Author Year)", "Title second source", "Page number second source")
                        cite1, cpages1 = _get_source("Cited source", "Title cited source", "Pages cited source")
                        cite2, cpages2 = _get_source("Second cited source", "Title second cited source", "Pages second cited source")

                        # 6. Entry — parse IDs with explicit invalid-format reporting
                        original_id, oid_ok = parse_int(row.get("ID 20250825"))
                        if not oid_ok:
                            import_report.add("invalid_format", {
                                "Row": excel_row, "Column": "ID 20250825",
                                "Original Value": row.get("ID 20250825"),
                                "Note": "Could not parse as int; stored as NULL.",
                            })

                        beginning_id, bid_ok = parse_int(row.get("ID beginning"))
                        if not bid_ok:
                            import_report.add("invalid_format", {
                                "Row": excel_row, "Column": "ID beginning",
                                "Original Value": row.get("ID beginning"),
                                "Note": "Could not parse as int; stored as NULL.",
                            })

                        if beginning_id is not None:
                            if beginning_id in seen_beginning_ids:
                                import_report.add("duplicate_beginning_id", {
                                    "Row": excel_row, "beginning_id": beginning_id,
                                    "Note": "Duplicate ID beginning; entry skipped.",
                                })
                                continue
                            seen_beginning_ids.add(beginning_id)

                        term = clean_value(row.get("Term"))
                        if not term:
                            continue  # skip rows without a term (silently)

                        entry = Entry(
                            original_id=original_id,
                            beginning_id=beginning_id,
                            term=term,
                            term_morph_analysis=clean_value(row.get("Term with Morphological Analysis")),
                            translation=clean_value(row.get("Translation")),
                            meaning=clean_value(row.get("Meaning")),
                            scientific_name=clean_value(row.get("Scientific name")),
                            semantic_field=clean_value(row.get("Semantic field")),
                            part_of_speech=clean_value(row.get("Part of Speech")),
                            blr_index=clean_value(row.get("BLR Index")),
                            ipa=clean_value(row.get("IPA")),
                            notes=clean_value(row.get("Opmerking")) or clean_value(row.get("Notes")),
                            variety_id=variety.id if variety else None,
                            location_id=location.id if location else None,
                            fieldwork_id=fieldwork.id if fieldwork else None,
                        )
                        session.add(entry)
                        session.flush()

                        # 7. Source links
                        for src, role, pages in [
                            (src1,  "primary", pages1),
                            (src2,  "second", pages2),
                            (cite1, "cited", cpages1),
                            (cite2, "second_cited", cpages2),
                        ]:
                            if src:
                                session.add(SourceEntries(
                                    entry_id=entry.id,
                                    source_id=src.id,
                                    role=role,
                                    pages=pages,
                                ))

                    except Exception as e:
                        logger.error(f"Error on row {excel_row}: {e}")
                        import_report.add("critical_error", {
                            "Row": excel_row, "Error Message": str(e),
                        })
                        continue

                session.commit()
                total_processed += len(batch)
                logger.info(f"Committed batch — total rows processed: {total_processed}")

            except Exception as e:
                logger.error(f"Batch error: {e}")
                session.rollback()
                continue

    logger.info("Import complete.")
    import_report.save("import_validation.xlsx")
    logger.info("Validation report saved to import_validation.xlsx")


if __name__ == "__main__":
    main()