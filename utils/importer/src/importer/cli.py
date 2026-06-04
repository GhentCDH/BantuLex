import logging
import time
from typing import Any

from openpyxl import load_workbook
from rich.logging import RichHandler
from sqlmodel import Session, SQLModel, select

from utilities.config import DATA_ROOT, DB_STRING, EXCEL
from utilities.db import engine, get_or_create
from utilities.model import (
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
    Reflex,
    Region,
    Source,
    SourceEntries,
    Variety,
)

from .blr import import_blr
from .columns import (
    COLLECTOR_PATTERN,
    CONSULTANT_PATTERN,
    EXPECTED_COLUMNS,
    SOURCE_GROUPS,
    WHITESPACE_CHECK_FIELDS,
)
from .parsing import (
    check_case_variant,
    chunked,
    clean_value,
    normalize_key,
    parse_float,
    parse_id_with_report,
    parse_uncertainty,
)
from .report import ImportReport

handler = RichHandler(
    rich_tracebacks=True,
    tracebacks_show_locals=True,
    markup=True,
    show_time=True,
    show_path=True,
)

logging.basicConfig(level=logging.INFO, format="%(message)s", handlers=[handler])
logger = logging.getLogger(__name__)


def main() -> None:
    start_time = time.monotonic()
    logger.info(f"Using database at {DB_STRING}")

    SQLModel.metadata.create_all(engine)

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
        return {h: c.value for h, c in zip(headers, rc, strict=False) if h is not None}

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

        def _preload(model, key_fn, cache, norm=None, guard=None):
            for x in session.exec(select(model)).all():
                if guard and not guard(x):
                    continue
                key = key_fn(x)
                cache[key] = x
                if norm is not None:
                    norm.setdefault(normalize_key(key), key)

        _preload(
            Variety,
            lambda v: (
                v.name_english,
                v.name_french,
                v.name_bantu,
                v.name_bastin,
                v.branch,
                v.bastin_index,
                v.guthrie_index,
                v.guthrie_plus,
            ),
            varieties_cache,
            varieties_norm,
        )
        _preload(Country, lambda c: (c.name,), countries_cache, countries_norm,
                 guard=lambda c: c.name)
        _preload(Region, lambda r: (r.name, r.country_id), regions_cache, regions_norm,
                 guard=lambda r: r.name)
        _preload(Place, lambda p: (p.name, p.region_id), places_cache,
                 guard=lambda p: p.name)
        _preload(Location, lambda loc: (loc.place_id, loc.region_id, loc.country_id),
                 locations_cache)
        _preload(Source, lambda s: (s.author_year, s.title), sources_cache, sources_norm)
        _preload(Project, lambda p: (p.name,), projects_cache, guard=lambda p: p.name)
        _preload(CollectionYear, lambda cy: (cy.value, cy.status), years_cache)
        _preload(DataCollector, lambda dc: (dc.name,), data_collectors_cache,
                 data_collectors_norm, guard=lambda dc: dc.name)
        _preload(Consultant, lambda c: (c.name,), consultants_cache, consultants_norm,
                 guard=lambda c: c.name)
        # Bulk-load link tables once instead of N+1 queries per fieldwork.
        fw_dc_map: dict[int, list[int]] = {}
        for lnk in session.exec(select(FieldworkDataCollector)).all():
            fw_dc_map.setdefault(lnk.fieldwork_id, []).append(lnk.data_collector_id)
        fw_con_map: dict[int, list[int]] = {}
        for lnk in session.exec(select(FieldworkConsultant)).all():
            fw_con_map.setdefault(lnk.fieldwork_id, []).append(lnk.consultant_id)
        for fw in session.exec(select(Fieldwork)).all():
            dc_ids = tuple(sorted(fw_dc_map.get(fw.id, [])))
            con_ids = tuple(sorted(fw_con_map.get(fw.id, [])))
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
        for batch in chunked(rows, 5000):
            # Deferred per-batch buffers: avoid one flush-with-RETURNING per row.
            batch_reflexes: list[Reflex] = []
            batch_source_links: list[tuple[Reflex, list[dict]]] = []
            try:
                for i, row_cells in enumerate(batch):
                    excel_row = total_processed + i + 2
                    row = row_to_dict(row_cells)
                    try:
                        # -- Whitespace variant detection --
                        for _col in WHITESPACE_CHECK_FIELDS:
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
                        check_case_variant(
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
                            check_case_variant(
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
                            check_case_variant(
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

                        def _add_coord(
                            lat: float,
                            lon: float,
                            desc: str,
                            *,
                            _loc=location,
                            _xrow=excel_row,
                            _row=row,
                        ) -> None:
                            if _loc is None:
                                return
                            tk = (_loc.id, desc)
                            if tk not in coord_seen:
                                session.add(
                                    Coordinate(
                                        location_id=_loc.id,
                                        latitude=lat,
                                        longitude=lon,
                                        description=desc,
                                    )
                                )
                                coord_seen[tk] = (lat, lon, _xrow)
                            else:
                                ex_lat, ex_lon, ex_row = coord_seen[tk]
                                if lat != ex_lat or lon != ex_lon:
                                    import_report.add(
                                        "coordinate_conflict",
                                        {
                                            "Row": _xrow,
                                            "Type": desc,
                                            "Existing Lat": ex_lat,
                                            "Existing Lon": ex_lon,
                                            "New Lat": lat,
                                            "New Lon": lon,
                                            "Term": clean_value(_row.get("Term")),
                                            "Variety (English)": clean_value(
                                                _row.get("Variety (English)")
                                            ),
                                            "Country": clean_value(_row.get("Country")),
                                            "Place": clean_value(_row.get("Place")),
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
                            filter(
                                None,
                                [
                                    clean_value(row.get(h))
                                    for h in headers
                                    if h and COLLECTOR_PATTERN.match(h)
                                ],
                            )
                        )
                        dc_objects = []
                        for name in dc_names:
                            check_case_variant(
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
                            filter(
                                None,
                                [
                                    clean_value(row.get(h))
                                    for h in headers
                                    if h and CONSULTANT_PATTERN.match(h)
                                ],
                            )
                        )
                        con_objects = []
                        for name in con_names:
                            check_case_variant(
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
                        for auth_col, title_col, page_col, role in SOURCE_GROUPS:
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
                            check_case_variant(
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

                        # 6. Reflex
                        original_id = parse_id_with_report(
                            row.get("ID 20250825"), "ID 20250825", excel_row, import_report
                        )
                        beginning_id = parse_id_with_report(
                            row.get("ID beginning"), "ID beginning", excel_row, import_report
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
                        # Defer add/flush — done once per batch below.
                        batch_reflexes.append(reflex)
                        batch_source_links.append((reflex, source_objects))

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

                # Bulk-insert all reflexes for this batch → one round trip for IDs,
                # then bulk-insert their SourceEntries with resolved entry_ids.
                if batch_reflexes:
                    session.add_all(batch_reflexes)
                    session.flush()
                    for reflex, source_objects in batch_source_links:
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
