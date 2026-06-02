import logging
import re
import time
from typing import Any

from openpyxl import load_workbook
from rich.logging import RichHandler
from sqlmodel import Session, SQLModel, select

from utilities.config import BLR_EXCEL, DATA_ROOT, DB_PATH, EXCEL
from utilities.db import create_updated_at_trigger, engine, get_or_create
from utilities.model import (
    BLRConsonantStructure,
    BLRContributor,
    BLRReliability,
    BLRToneStructure,
    BLRVowelStructure,
    CollectionYear,
    Consultant,
    Coordinate,
    Country,
    DataCollector,
    Fieldwork,
    FieldworkConsultant,
    FieldworkDataCollector,
    Location,
    Place,
    Project,
    Reconstruction,
    Reflex,
    Region,
    Source,
    SourceEntries,
    Variety,
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


def clean_value(val: Any) -> str | None:
    if val is None or val == "" or str(val).lower() == "nan":
        return None
    s = str(val).strip()
    return s if s else None


def parse_float(val: Any) -> float | None:
    try:
        return float(val) if val is not None else None
    except (ValueError, TypeError):
        return None


def parse_int(val: Any) -> tuple[int | None, bool]:
    """Returns (parsed_int_or_None, success_bool)."""
    if val is None:
        return None, True
    try:
        return int(val), True
    except (ValueError, TypeError):
        return None, False


def parse_uncertainty(val: Any) -> tuple[str | None, bool]:
    """
    Strip uncertainty markers; return (cleaned_value, is_uncertain).

    Examples:
        "?????" or "???"             -> (None, True)
        "Bouka 1989?"                -> ("Bouka 1989", True)
        "Crine 1981 (?)"             -> ("Crine 1981", True)
        "Daeleman 1975 (or 1976?)"   -> ("Daeleman 1975 (or 1976)", True)
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
    cleaned = re.sub(r"\s*\(\?\)\s*", " ", s).strip()
    cleaned = re.sub(r"\?", "", cleaned).strip()
    return cleaned, True


def _normalize_key(key: tuple) -> tuple:
    """Case- and whitespace-insensitive version of a cache key for near-duplicate detection."""
    return tuple(v.casefold().strip() if isinstance(v, str) else v for v in key)


def _check_case_variant(
    norm_map: dict[tuple, tuple],
    key: tuple,
    entity: str,
    excel_row: int,
    report: "ImportReport",
    extra: dict[str, Any] | None = None,
) -> None:
    """Log a case_variant warning when the same key exists with different capitalisation."""
    norm = _normalize_key(key)
    if norm in norm_map and norm_map[norm] != key:
        entry: dict[str, Any] = {
            "Row": excel_row,
            "Entity": entity,
            "New Value": " | ".join(str(v) for v in key if v is not None),
            "Existing Value": " | ".join(
                str(v) for v in norm_map[norm] if v is not None
            ),
            "Note": "Zelfde waarden, ander hoofdlettergebruik — mogelijke duplicaat.",
        }
        if extra:
            entry.update(extra)
        report.add("case_variant", entry)
    else:
        norm_map.setdefault(norm, key)


# ---------------------------------------------------------------------------
# Import report
# ---------------------------------------------------------------------------


class ImportReport:
    CATEGORIES = [
        "uncertainty",
        "fallback_used",
        "coordinate_conflict",
        "invalid_format",
        "duplicate_beginning_id",
        "case_variant",  # same key, different capitalisation
        "whitespace_variant",  # raw value had leading/trailing whitespace
        "missing_column",  # expected column absent from header
        "suspicious_duplicate",  # same term + variety combination
        "source_incomplete",  # author_year without title or vice versa
        "skipped_no_term",  # row silently skipped due to missing term
        "blr_unresolved_link",  # BLR index in Reflex has no matching Reconstruction
        "critical_error",
    ]

    def __init__(self) -> None:
        self.categories: dict[str, list[dict[str, Any]]] = {
            c: [] for c in self.CATEGORIES
        }

    def add(self, category: str, data: dict[str, Any]) -> None:
        self.categories.setdefault(category, []).append(data)

    def summary(self) -> dict[str, int]:
        """Return a dict of category -> count for non-empty categories."""
        return {c: len(v) for c, v in self.categories.items() if v}

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
# Expected columns
# ---------------------------------------------------------------------------

EXPECTED_COLUMNS = [
    "Variety (English)",
    "variety (French)",
    "Variety (Bantu)",
    "Variety as named in Bastin",
    "Branch",
    "Bastin Index",
    "Guthrie Index",
    "Guthrie PLUS",
    "Country",
    "Region (fieldwork)",
    "Place",
    "Latitude",
    "Longitude",
    "Latitude OR source",
    "Longitude OR source",
    "Project",
    "Year of collection",
    "Data collector 1",
    "Data collector 2",
    "Consultant 1",
    "Consultant 2",
    "Consultant 3",
    "Consultant 4",
    "Archive",
    "Data entered by",
    "Source (Author YEAR)",
    "Title",
    "Page number",
    "Second source (Author Year)",
    "Title second source",
    "Page number second source",
    "Cited source",
    "Title cited source",
    "Pages cited source",
    "Second cited source",
    "Title second cited source",
    "Pages second cited source",
    "ID 20250825",
    "ID beginning",
    "Term",
    "Term with Morphological Analysis",
    "Translation",
    "Meaning",
    "Scientific name",
    "Semantic field",
    "Part of Speech",
    "BLR Index",
    "IPA",
    "Opmerking",
    "Notes",
]

# Field names for dynamic grouping
_COLLECTOR_PATTERN = re.compile(r"Data collector \d+")
_CONSULTANT_PATTERN = re.compile(r"Consultant \d+")

# Source groups (Author/Year, Title, Page, Role)
# Unified role system: everyone is 'primary' or 'cited', 'order' handles slots.
_SOURCE_GROUPS = [
    ("Source (Author YEAR)", "Title", "Page number", "primary"),
    (
        "Second source (Author Year)",
        "Title second source",
        "Page number second source",
        "primary",
    ),
    ("Source Fieldwork (data collector YEAR)", None, None, "primary"),
    ("Cited source", "Title cited source", "Pages cited source", "cited"),
    (
        "Second cited source",
        "Title second cited source",
        "Pages second cited source",
        "cited",
    ),
]

# Fields to check for leading/trailing whitespace before clean_value strips them
_WHITESPACE_CHECK_FIELDS = [
    "Variety (English)",
    "variety (French)",
    "Variety (Bantu)",
    "Country",
    "Region (fieldwork)",
    "Place",
    "Source (Author YEAR)",
    "Second source (Author Year)",
    "Data collector 1",
    "Data collector 2",
    "Term",
]


# ---------------------------------------------------------------------------
# BLR import
# ---------------------------------------------------------------------------


def import_blr(import_report: ImportReport | None = None) -> None:
    """Import BLR.xlsx into the reconstruction table and link existing entries."""
    SQLModel.metadata.create_all(engine)

    if not BLR_EXCEL.exists():
        logger.warning(f"BLR file not found at {BLR_EXCEL}")
        return

    logger.info(f"Reading BLR: {BLR_EXCEL}")
    wb = load_workbook(BLR_EXCEL, read_only=True, data_only=True)
    ws = wb.active
    rows = ws.rows

    try:
        header_row = next(rows)
    except StopIteration:
        logger.error("Empty BLR file.")
        return

    headers = [
        str(c.value).strip() if c.value is not None else None for c in header_row
    ]

    def row_to_dict(rc) -> dict:
        return {h: c.value for h, c in zip(headers, rc) if h is not None}

    blr_index_map: dict[int, int] = {}

    contributors_cache: dict[tuple, BLRContributor] = {}
    reliability_cache: dict[tuple, BLRReliability] = {}
    consonant_cache: dict[tuple, BLRConsonantStructure] = {}
    vowel_cache: dict[tuple, BLRVowelStructure] = {}
    tone_cache: dict[tuple, BLRToneStructure] = {}

    with Session(engine, expire_on_commit=False) as session:
        for existing in session.exec(select(Reconstruction)).all():
            if existing.blr_index is not None:
                blr_index_map[existing.blr_index] = existing.id
        for x in session.exec(select(BLRContributor)).all():
            if x.name:
                contributors_cache[(x.name,)] = x
        for x in session.exec(select(BLRReliability)).all():
            if x.value:
                reliability_cache[(x.value,)] = x
        for x in session.exec(select(BLRConsonantStructure)).all():
            consonant_cache[(x.c1, x.c2, x.c3, x.c4, x.cs)] = x
        for x in session.exec(select(BLRVowelStructure)).all():
            vowel_cache[(x.v11, x.v12, x.v21, x.v22, x.v3, x.v4)] = x
        for x in session.exec(select(BLRToneStructure)).all():
            tone_cache[(x.t11, x.t12, x.t21, x.t22, x.t3, x.t4)] = x

        inserted = 0
        for row_cells in rows:
            row = row_to_dict(row_cells)

            idx_raw, idx_ok = parse_int(row.get("Index"))
            if not idx_ok or idx_raw is None:
                continue
            if idx_raw in blr_index_map:
                continue

            contributor_name = clean_value(row.get("Added by"))
            contributor = (
                get_or_create(
                    contributors_cache,
                    (contributor_name,),
                    lambda n=contributor_name: BLRContributor(name=n),
                    session,
                )
                if contributor_name
                else None
            )

            reliability_val = clean_value(row.get("Fiab:"))
            reliability = (
                get_or_create(
                    reliability_cache,
                    (reliability_val,),
                    lambda v=reliability_val: BLRReliability(value=v),
                    session,
                )
                if reliability_val
                else None
            )

            c_key = (
                clean_value(row.get("C1")),
                clean_value(row.get("C2")),
                clean_value(row.get("C3")),
                clean_value(row.get("C4")),
                clean_value(row.get("CS")),
            )
            consonant_structure = (
                get_or_create(
                    consonant_cache,
                    c_key,
                    lambda k=c_key: BLRConsonantStructure(
                        c1=k[0], c2=k[1], c3=k[2], c4=k[3], cs=k[4]
                    ),
                    session,
                )
                if any(c_key)
                else None
            )

            v_key = (
                clean_value(row.get("V11")),
                clean_value(row.get("V12")),
                clean_value(row.get("V21")),
                clean_value(row.get("V22")),
                clean_value(row.get("V3")),
                clean_value(row.get("V4")),
            )
            vowel_structure = (
                get_or_create(
                    vowel_cache,
                    v_key,
                    lambda k=v_key: BLRVowelStructure(
                        v11=k[0], v12=k[1], v21=k[2], v22=k[3], v3=k[4], v4=k[5]
                    ),
                    session,
                )
                if any(v_key)
                else None
            )

            t_key = (
                clean_value(row.get("T11")),
                clean_value(row.get("T12")),
                clean_value(row.get("T21")),
                clean_value(row.get("T22")),
                clean_value(row.get("T3")),
                clean_value(row.get("T4")),
            )
            tone_structure = (
                get_or_create(
                    tone_cache,
                    t_key,
                    lambda k=t_key: BLRToneStructure(
                        t11=k[0], t12=k[1], t21=k[2], t22=k[3], t3=k[4], t4=k[5]
                    ),
                    session,
                )
                if any(t_key)
                else None
            )

            blr = Reconstruction(
                blr_index=idx_raw,
                word_tone=clean_value(row.get("Word\\Tone")),
                word=clean_value(row.get("Word")),
                english=clean_value(row.get("English")),
                french=clean_value(row.get("Français:")),
                noun_class=clean_value(row.get("N class")),
                distribution=clean_value(row.get("Distr:")),
                note=clean_value(row.get("Note")),
                proto_kk=clean_value(row.get("Proto KK")),
                date_of_entry=clean_value(row.get("Date of entry")),
                contributor_id=contributor.id if contributor else None,
                reliability_id=reliability.id if reliability else None,
                consonant_structure_id=consonant_structure.id
                if consonant_structure
                else None,
                vowel_structure_id=vowel_structure.id if vowel_structure else None,
                tone_structure_id=tone_structure.id if tone_structure else None,
            )
            session.add(blr)
            session.flush()
            blr_index_map[idx_raw] = blr.id
            inserted += 1

        session.commit()
        logger.info(f"BLR import done — {inserted} new entries inserted.")

        # Link Reflex.blr_entry_id via Reflex.blr_index (integer match)
        linked = 0
        unresolved = 0
        for reflex in session.exec(
            select(Reflex).where(
                Reflex.blr_index.is_not(None),
                Reflex.blr_entry_id.is_(None),
            )
        ).all():
            try:
                idx = int(reflex.blr_index)
            except (ValueError, TypeError):
                unresolved += 1
                if import_report:
                    import_report.add(
                        "blr_unresolved_link",
                        {
                            "Reflex ID": reflex.id,
                            "BLR Index (raw)": reflex.blr_index,
                            "Note": "BLR index kon niet als integer worden geparsed.",
                        },
                    )
                continue
            blr_id = blr_index_map.get(idx)
            if blr_id:
                reflex.blr_entry_id = blr_id
                linked += 1
            else:
                unresolved += 1
                if import_report:
                    import_report.add(
                        "blr_unresolved_link",
                        {
                            "Reflex ID": reflex.id,
                            "BLR Index": idx,
                            "Note": "Geen overeenkomende BLR Reconstruction gevonden voor dit index.",
                        },
                    )

        session.commit()
        logger.info(f"Linked {linked} entries to BLR — {unresolved} unresolved.")


# ---------------------------------------------------------------------------
# Main import
# ---------------------------------------------------------------------------


def main() -> None:
    start_time = time.monotonic()
    logger.info(f"Using database at {DB_PATH}")

    SQLModel.metadata.create_all(engine)
    create_updated_at_trigger(engine)

    if not EXCEL.exists():
        logger.warning(f"Excel file not found at {EXCEL}")
        return

    logger.info(f"Reading: {EXCEL}")
    wb = load_workbook(EXCEL, read_only=True, data_only=True)
    ws = wb.active
    logger.info(f"Worksheet: '{ws.title}' | rows (approx): {ws.max_row}")

    rows = ws.rows
    try:
        header_row = next(rows)
    except StopIteration:
        logger.error("Empty Excel file.")
        return

    headers = [
        str(c.value).strip() if c.value is not None else None for c in header_row
    ]

    logger.info(f"Columns: {[h for h in headers if h]}")

    import_report = ImportReport()

    # Check for missing expected columns
    header_set = {h for h in headers if h}
    for col in EXPECTED_COLUMNS:
        if col not in header_set:
            import_report.add(
                "missing_column",
                {
                    "Column": col,
                    "Note": "Verwachte kolom niet aanwezig in het Excel-bestand.",
                },
            )
            logger.warning(f"Missing expected column: '{col}'")

    def row_to_dict(rc) -> dict:
        return {h: c.value for h, c in zip(headers, rc) if h is not None}

    # -----------------------------------------------------------------------
    # In-memory caches (key -> ORM object)
    # -----------------------------------------------------------------------
    varieties_cache: dict[tuple, Variety] = {}
    countries_cache: dict[tuple, Country] = {}
    regions_cache: dict[tuple, Region] = {}
    places_cache: dict[tuple, Place] = {}
    locations_cache: dict[tuple, Location] = {}
    sources_cache: dict[tuple, Source] = {}
    projects_cache: dict[tuple, Project] = {}
    years_cache: dict[tuple, CollectionYear] = {}
    data_collectors_cache: dict[tuple, DataCollector] = {}
    consultants_cache: dict[tuple, Consultant] = {}
    fieldworks_cache: dict[tuple, Fieldwork] = {}

    # Normalised caches for case-variant detection (normalised_key -> original_key)
    varieties_norm: dict[tuple, tuple] = {}
    countries_norm: dict[tuple, tuple] = {}
    regions_norm: dict[tuple, tuple] = {}
    data_collectors_norm: dict[tuple, tuple] = {}
    consultants_norm: dict[tuple, tuple] = {}
    sources_norm: dict[tuple, tuple] = {}

    # (location_id, description) -> (lat, lon, excel_row)
    coord_seen: dict[tuple[int, str], tuple[float, float, int]] = {}
    # beginning_id -> first excel_row
    seen_beginning_ids: dict[int, int] = {}
    # (term, variety_id) -> first excel_row
    seen_term_variety: dict[tuple[str, Any], int] = {}

    total_processed = 0

    with Session(engine, expire_on_commit=False) as session:
        # -------------------------------------------------------------------
        # Pre-load caches from existing DB rows
        # -------------------------------------------------------------------
        logger.info("Pre-loading caches from database...")

        for v in session.exec(select(Variety)).all():
            k = (
                v.name_english,
                v.name_french,
                v.name_bantu,
                v.name_bastin,
                v.branch,
                v.bastin_index,
                v.guthrie_index,
                v.guthrie_plus,
            )
            varieties_cache[k] = v
            varieties_norm.setdefault(_normalize_key(k), k)
        for c in session.exec(select(Country)).all():
            if c.name:
                countries_cache[(c.name,)] = c
                countries_norm.setdefault(_normalize_key((c.name,)), (c.name,))
        for r in session.exec(select(Region)).all():
            if r.name:
                regions_cache[(r.name, r.country_id)] = r
                regions_norm.setdefault(
                    _normalize_key((r.name, r.country_id)), (r.name, r.country_id)
                )
        for p in session.exec(select(Place)).all():
            if p.name:
                places_cache[(p.name, p.region_id)] = p
        for loc in session.exec(select(Location)).all():
            locations_cache[(loc.place_id, loc.region_id, loc.country_id)] = loc
        for s in session.exec(select(Source)).all():
            sources_cache[(s.author_year, s.title)] = s
            sources_norm.setdefault(
                _normalize_key((s.author_year, s.title)), (s.author_year, s.title)
            )
        for proj in session.exec(select(Project)).all():
            if proj.name:
                projects_cache[(proj.name,)] = proj
        for cy in session.exec(select(CollectionYear)).all():
            years_cache[(cy.value, cy.status)] = cy
        for dc in session.exec(select(DataCollector)).all():
            if dc.name:
                data_collectors_cache[(dc.name,)] = dc
                data_collectors_norm.setdefault(_normalize_key((dc.name,)), (dc.name,))
        for c in session.exec(select(Consultant)).all():
            if c.name:
                consultants_cache[(c.name,)] = c
                consultants_norm.setdefault(_normalize_key((c.name,)), (c.name,))
        for fw in session.exec(select(Fieldwork)).all():
            dc_ids = tuple(
                sorted(
                    lnk.data_collector_id
                    for lnk in session.exec(
                        select(FieldworkDataCollector).where(
                            FieldworkDataCollector.fieldwork_id == fw.id
                        )
                    ).all()
                )
            )
            con_ids = tuple(
                sorted(
                    lnk.consultant_id
                    for lnk in session.exec(
                        select(FieldworkConsultant).where(
                            FieldworkConsultant.fieldwork_id == fw.id
                        )
                    ).all()
                )
            )
            k = (
                fw.project_id,
                fw.collection_year_id,
                fw.archive,
                fw.data_entered_by,
                dc_ids,
                con_ids,
            )
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
                        # -- Whitespace variant detection --
                        for _col in _WHITESPACE_CHECK_FIELDS:
                            _raw = row.get(_col)
                            if (
                                _raw is not None
                                and isinstance(_raw, str)
                                and _raw != _raw.strip()
                            ):
                                import_report.add(
                                    "whitespace_variant",
                                    {
                                        "Row": excel_row,
                                        "Column": _col,
                                        "Raw Value": repr(_raw),
                                        "Stripped Value": _raw.strip(),
                                        "Note": "Waarde bevat overbodige spaties — automatisch gestript.",
                                    },
                                )

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
                        _check_case_variant(
                            varieties_norm,
                            v_key,
                            "Variety",
                            excel_row,
                            import_report,
                            extra={"Term": clean_value(row.get("Term"))},
                        )
                        variety = get_or_create(
                            varieties_cache,
                            v_key,
                            lambda k=v_key: Variety(
                                name_english=k[0],
                                name_french=k[1],
                                name_bantu=k[2],
                                name_bastin=k[3],
                                branch=k[4],
                                bastin_index=k[5],
                                guthrie_index=k[6],
                                guthrie_plus=k[7],
                            ),
                            session,
                        )

                        # 2. Location hierarchy (clan excluded per project decision)
                        country_val = clean_value(row.get("Country"))
                        if country_val:
                            _check_case_variant(
                                countries_norm,
                                (country_val,),
                                "Country",
                                excel_row,
                                import_report,
                            )
                        country = (
                            get_or_create(
                                countries_cache,
                                (country_val,),
                                lambda n=country_val: Country(name=n),
                                session,
                            )
                            if country_val
                            else None
                        )

                        region_val = clean_value(row.get("Region (fieldwork)"))
                        r_key = (region_val, country.id if country else None)
                        if region_val:
                            _check_case_variant(
                                regions_norm, r_key, "Region", excel_row, import_report
                            )
                        region = (
                            get_or_create(
                                regions_cache,
                                r_key,
                                lambda k=r_key: Region(name=k[0], country_id=k[1]),
                                session,
                            )
                            if region_val
                            else None
                        )

                        place_val = clean_value(row.get("Place"))
                        p_key = (place_val, region.id if region else None)
                        place = (
                            get_or_create(
                                places_cache,
                                p_key,
                                lambda k=p_key: Place(name=k[0], region_id=k[1]),
                                session,
                            )
                            if place_val
                            else None
                        )

                        loc_key = (
                            place.id if place else None,
                            region.id if region else None,
                            country.id if country else None,
                        )
                        location = get_or_create(
                            locations_cache,
                            loc_key,
                            lambda k=loc_key: Location(
                                place_id=k[0], region_id=k[1], country_id=k[2]
                            ),
                            session,
                        )

                        # 3. Coordinates (BK/BL primary; BM/BN as fallback)
                        lat_def = parse_float(row.get("Latitude"))
                        lon_def = parse_float(row.get("Longitude"))
                        lat_src = parse_float(row.get("Latitude OR source"))
                        lon_src = parse_float(row.get("Longitude OR source"))

                        if (
                            (lat_def is None or lon_def is None)
                            and lat_src is not None
                            and lon_src is not None
                        ):
                            lat_def, lon_def = lat_src, lon_src
                            import_report.add(
                                "fallback_used",
                                {
                                    "Row": excel_row,
                                    "Note": "BK/BL leeg; gekopieerd van BM/BN (OR source)",
                                    "Lat used": lat_def,
                                    "Lon used": lon_def,
                                },
                            )

                        def _add_coord(lat: float, lon: float, desc: str) -> None:
                            if location is None:
                                return
                            tk = (location.id, desc)
                            if tk not in coord_seen:
                                session.add(
                                    Coordinate(
                                        location_id=location.id,
                                        latitude=lat,
                                        longitude=lon,
                                        description=desc,
                                    )
                                )
                                coord_seen[tk] = (lat, lon, excel_row)
                            else:
                                ex_lat, ex_lon, ex_row = coord_seen[tk]
                                if lat != ex_lat or lon != ex_lon:
                                    import_report.add(
                                        "coordinate_conflict",
                                        {
                                            "Row": excel_row,
                                            "Type": desc,
                                            "Existing Lat": ex_lat,
                                            "Existing Lon": ex_lon,
                                            "New Lat": lat,
                                            "New Lon": lon,
                                            "Term": clean_value(row.get("Term")),
                                            "Variety (English)": clean_value(
                                                row.get("Variety (English)")
                                            ),
                                            "Country": clean_value(row.get("Country")),
                                            "Place": clean_value(row.get("Place")),
                                            "Conflicting Row": ex_row,
                                        },
                                    )

                        if lat_def is not None and lon_def is not None:
                            _add_coord(lat_def, lon_def, "default")
                        if lat_src is not None and lon_src is not None:
                            _add_coord(lat_src, lon_src, "original")

                        # 4. Fieldwork

                        # 4a. Project
                        project_val = clean_value(row.get("Project"))
                        project = (
                            get_or_create(
                                projects_cache,
                                (project_val,),
                                lambda n=project_val: Project(name=n),
                                session,
                            )
                            if project_val
                            else None
                        )

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
                                import_report.add(
                                    "uncertainty",
                                    {
                                        "Row": excel_row,
                                        "Column": "Year of collection",
                                        "Original Value": f_year_raw,
                                        "Cleaned Value": f_year_val,
                                        "Status": year_status,
                                        "Note": "Jaar onzeker; controleer op alternatief jaar indien aanwezig.",
                                    },
                                )

                            year_key = (f_year_val, year_status)
                            collection_year = get_or_create(
                                years_cache,
                                year_key,
                                lambda k=year_key: CollectionYear(
                                    value=k[0], status=k[1]
                                ),
                                session,
                            )

                        # 4c. Data collectors (dynamic detection)
                        dc_names = sorted(
                            list(
                                filter(
                                    None,
                                    [
                                        clean_value(row.get(h))
                                        for h in headers
                                        if h and _COLLECTOR_PATTERN.match(h)
                                    ],
                                )
                            )
                        )
                        dc_objects = []
                        for name in dc_names:
                            _check_case_variant(
                                data_collectors_norm,
                                (name,),
                                "DataCollector",
                                excel_row,
                                import_report,
                            )
                            dc_objects.append(
                                get_or_create(
                                    data_collectors_cache,
                                    (name,),
                                    lambda n=name: DataCollector(name=n),
                                    session,
                                )
                            )

                        # 4d. Consultants (dynamic detection)
                        con_names = sorted(
                            list(
                                filter(
                                    None,
                                    [
                                        clean_value(row.get(h))
                                        for h in headers
                                        if h and _CONSULTANT_PATTERN.match(h)
                                    ],
                                )
                            )
                        )
                        con_objects = []
                        for name in con_names:
                            _check_case_variant(
                                consultants_norm,
                                (name,),
                                "Consultant",
                                excel_row,
                                import_report,
                            )
                            con_objects.append(
                                get_or_create(
                                    consultants_cache,
                                    (name,),
                                    lambda n=name: Consultant(name=n),
                                    session,
                                )
                            )

                        # 4e. Fieldwork
                        archive_val = clean_value(row.get("Archive"))
                        entered_by = clean_value(row.get("Data entered by"))
                        dc_id_tuple = tuple(sorted(dc.id for dc in dc_objects))
                        con_id_tuple = tuple(sorted(c.id for c in con_objects))

                        f_key = (
                            project.id if project else None,
                            collection_year.id if collection_year else None,
                            archive_val,
                            entered_by,
                            dc_id_tuple,
                            con_id_tuple,
                        )
                        fieldwork = None
                        if any(k is not None for k in f_key):
                            if f_key in fieldworks_cache:
                                fieldwork = fieldworks_cache[f_key]
                            else:
                                fieldwork = Fieldwork(
                                    project_id=project.id if project else None,
                                    collection_year_id=collection_year.id
                                    if collection_year
                                    else None,
                                    archive=archive_val,
                                    data_entered_by=entered_by,
                                )
                                session.add(fieldwork)
                                session.flush()
                                for dc in dc_objects:
                                    session.add(
                                        FieldworkDataCollector(
                                            fieldwork_id=fieldwork.id,
                                            data_collector_id=dc.id,
                                        )
                                    )
                                for con in con_objects:
                                    session.add(
                                        FieldworkConsultant(
                                            fieldwork_id=fieldwork.id,
                                            consultant_id=con.id,
                                        )
                                    )
                                fieldworks_cache[f_key] = fieldwork

                        # 5. Sources
                        source_objects = []
                        for auth_col, title_col, page_col, role in _SOURCE_GROUPS:
                            auth_raw = clean_value(row.get(auth_col))
                            if not auth_raw:
                                continue

                            title_val = (
                                clean_value(row.get(title_col)) if title_col else None
                            )
                            page_val = (
                                clean_value(row.get(page_col)) if page_col else None
                            )

                            # Basic validation: if title column exists, both should be present
                            if title_col and bool(auth_raw) != bool(title_val):
                                import_report.add(
                                    "source_incomplete",
                                    {
                                        "Row": excel_row,
                                        "Author/Year Column": auth_col,
                                        "Author/Year Value": auth_raw or "(leeg)",
                                        "Title Column": title_col,
                                        "Title Value": title_val or "(leeg)",
                                        "Note": "Bron heeft wel auteur/jaar maar geen titel, of omgekeerd.",
                                    },
                                )

                            auth_val, unc = parse_uncertainty(auth_raw)
                            if unc:
                                import_report.add(
                                    "uncertainty",
                                    {
                                        "Row": excel_row,
                                        "Column": auth_col,
                                        "Original Value": auth_raw,
                                        "Cleaned Value": auth_val,
                                        "Note": "Onzeker jaar; controleer op alternatief indien aanwezig.",
                                    },
                                )

                            s_key = (auth_val, title_val)
                            _check_case_variant(
                                sources_norm,
                                s_key,
                                "Source",
                                excel_row,
                                import_report,
                                extra={"Column": auth_col},
                            )
                            source = get_or_create(
                                sources_cache,
                                s_key,
                                lambda k=s_key, u=unc: Source(
                                    author_year=k[0], year_uncertain=u, title=k[1]
                                ),
                                session,
                            )

                            # Determine order: increment for the same role within this record
                            order = 1 + sum(
                                1 for s in source_objects if s["role"] == role
                            )
                            source_objects.append(
                                {
                                    "source_id": source.id,
                                    "role": role,
                                    "order": order,
                                    "pages": page_val,
                                }
                            )

                        # 6. Reflex — parse IDs with explicit invalid-format reporting
                        original_id, oid_ok = parse_int(row.get("ID 20250825"))
                        if not oid_ok:
                            import_report.add(
                                "invalid_format",
                                {
                                    "Row": excel_row,
                                    "Column": "ID 20250825",
                                    "Original Value": row.get("ID 20250825"),
                                    "Note": "Kon niet worden geparsed als int; opgeslagen als NULL.",
                                },
                            )

                        beginning_id, bid_ok = parse_int(row.get("ID beginning"))
                        if not bid_ok:
                            import_report.add(
                                "invalid_format",
                                {
                                    "Row": excel_row,
                                    "Column": "ID beginning",
                                    "Original Value": row.get("ID beginning"),
                                    "Note": "Kon niet worden geparsed als int; opgeslagen als NULL.",
                                },
                            )

                        if beginning_id is not None:
                            if beginning_id in seen_beginning_ids:
                                import_report.add(
                                    "duplicate_beginning_id",
                                    {
                                        "Row": excel_row,
                                        "beginning_id": beginning_id,
                                        "First seen at Row": seen_beginning_ids[
                                            beginning_id
                                        ],
                                        "Term": clean_value(row.get("Term")),
                                        "Variety (English)": clean_value(
                                            row.get("Variety (English)")
                                        ),
                                        "Note": "Dubbel ID beginning — rij geskipt.",
                                    },
                                )
                                continue
                            seen_beginning_ids[beginning_id] = excel_row

                        term = clean_value(row.get("Term"))
                        if not term:
                            import_report.add(
                                "skipped_no_term",
                                {
                                    "Row": excel_row,
                                    "Variety (English)": v_key[0],
                                    "Guthrie Index": v_key[6],
                                    "Country": clean_value(row.get("Country")),
                                    "Note": "Rij geskipt: geen waarde in kolom 'Term'.",
                                },
                            )
                            continue

                        # Suspicious duplicate: same term + variety combination
                        tv_key = (term, variety.id if variety else None)
                        if tv_key in seen_term_variety:
                            import_report.add(
                                "suspicious_duplicate",
                                {
                                    "Row": excel_row,
                                    "First seen at Row": seen_term_variety[tv_key],
                                    "Term": term,
                                    "Variety (English)": v_key[0],
                                    "Guthrie Index": v_key[6],
                                    "Note": "Zelfde term + variëteit al eerder gezien — mogelijke duplicaat.",
                                },
                            )
                        else:
                            seen_term_variety[tv_key] = excel_row

                        reflex = Reflex(
                            original_id=original_id,
                            beginning_id=beginning_id,
                            term=term,
                            term_morph_analysis=clean_value(
                                row.get("Term with Morphological Analysis")
                            ),
                            translation=clean_value(row.get("Translation")),
                            meaning=clean_value(row.get("Meaning")),
                            scientific_name=clean_value(row.get("Scientific name")),
                            semantic_field=clean_value(row.get("Semantic field")),
                            part_of_speech=clean_value(row.get("Part of Speech")),
                            blr_index=clean_value(row.get("BLR Index")),
                            ipa=clean_value(row.get("IPA")),
                            notes=clean_value(row.get("Opmerking"))
                            or clean_value(row.get("Notes")),
                            variety_id=variety.id if variety else None,
                            location_id=location.id if location else None,
                            fieldwork_id=fieldwork.id if fieldwork else None,
                        )
                        session.add(reflex)
                        session.flush()

                        # 7. Source links
                        for s_data in source_objects:
                            session.add(
                                SourceEntries(
                                    entry_id=reflex.id,
                                    source_id=s_data["source_id"],
                                    role=s_data["role"],
                                    order=s_data["order"],
                                    pages=s_data["pages"],
                                )
                            )

                    except Exception as e:
                        logger.error(f"Error on row {excel_row}: {e}")
                        import_report.add(
                            "critical_error",
                            {
                                "Row": excel_row,
                                "Error Message": str(e),
                            },
                        )
                        continue

                session.commit()
                total_processed += len(batch)
                logger.info(
                    f"Committed batch — total rows processed: {total_processed}"
                )

            except Exception as e:
                logger.error(f"Batch error: {e}")
                session.rollback()
                continue

    import_blr(import_report)

    elapsed = time.monotonic() - start_time
    logger.info(f"Import complete in {elapsed:.1f}s.")

    # Validation summary in terminal
    summary = import_report.summary()
    if summary:
        logger.warning("Validation summary:")
        for category, count in sorted(summary.items(), key=lambda x: -x[1]):
            logger.warning(f"  {category}: {count} issue(s)")
    else:
        logger.info("Validation: geen problemen gevonden.")

    import_report.save(str(DATA_ROOT / "import_validation.xlsx"))
    logger.info(f"Validation report saved to {DATA_ROOT / 'import_validation.xlsx'}")


if __name__ == "__main__":
    main()
