import logging

from openpyxl import load_workbook
from sqlmodel import Session, select

from utilities.config import BLR_EXCEL
from utilities.db import create_all, engine, get_or_create
from utilities.model import (
    BLRConsonantStructure,
    BLRContributor,
    BLRReliability,
    BLRToneStructure,
    BLRVowelStructure,
    Reconstruction,
    Reflex,
)

from .entries import (
    BlrDuplicateIndexEntry,
    BlrEmptyRowEntry,
    BlrMissingWordEntry,
    BlrUnresolvedLinkEntry,
    MissingColumnEntry,
    RowContext,
    SourceLocation,
    build_col_index,
)
from .report import ImportReport

logger = logging.getLogger(__name__)

# BLR workbooks are read by header name, so their column order does not matter.
BLR_EXPECTED_HEADERS = [
    "Word\\Tone",
    "Index",
    "English",
    "Added by",
    "C1",
    "C2",
    "C3",
    "C4",
    "CS",
    "Date of entry",
    "Distr:",
    "Fiab:",
    "Français:",
    "N class",
    "Note",
    "Proto KK",
    "T11",
    "T12",
    "T21",
    "T22",
    "T3",
    "T4",
    "V11",
    "V12",
    "V21",
    "V22",
    "V3",
    "V4",
    "Word",
]


def import_blr(import_report: ImportReport | None = None) -> None:
    """Import the configured BLR workbook into the reconstruction table.

    Existing reconstructions are updated in place (matched on `blr_index`), so
    a newer export can refresh a live database. Reflex links are resolved
    afterwards.
    """
    create_all(engine)

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
        return {h: c.value for h, c in zip(headers, rc, strict=False) if h is not None}

    # Discarded when running standalone without a shared report.
    report = import_report if import_report is not None else ImportReport()
    file_name = BLR_EXCEL.name
    sheet_name = ws.title
    col_index = build_col_index(headers)

    present = {h for h in headers if h}
    for missing in sorted(set(BLR_EXPECTED_HEADERS) - present):
        report.add(
            MissingColumnEntry(
                loc=SourceLocation(file_name, sheet_name, None, missing, None),
                note=f"Kolom '{missing}' ontbreekt in {file_name}; waarde blijft leeg.",
            )
        )
    extra = sorted(present - set(BLR_EXPECTED_HEADERS))
    if extra:
        logger.warning(f"Ignoring unknown BLR columns: {', '.join(extra)}")

    existing_by_index: dict[int, Reconstruction] = {}

    contributors_cache: dict[tuple, BLRContributor] = {}
    reliability_cache: dict[tuple, BLRReliability] = {}
    consonant_cache: dict[tuple, BLRConsonantStructure] = {}
    vowel_cache: dict[tuple, BLRVowelStructure] = {}
    tone_cache: dict[tuple, BLRToneStructure] = {}

    with Session(engine, expire_on_commit=False) as session:
        for existing in session.exec(select(Reconstruction)).all():
            if existing.blr_index is not None:
                existing_by_index[existing.blr_index] = existing
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
        updated = 0
        seen_in_file: dict[int, int] = {}
        for excel_row, row_cells in enumerate(rows, start=2):
            row = row_to_dict(row_cells)
            ctx = RowContext(file_name, sheet_name, excel_row, col_index, report, row)

            idx_raw = ctx.int("Index")
            if idx_raw is None:
                continue
            if idx_raw in seen_in_file:
                report.add(
                    BlrDuplicateIndexEntry(
                        loc=ctx.loc("Index"),
                        note="Dubbele BLR-index in het bestand; deze rij is overgeslagen.",
                        blr_index=idx_raw,
                        first_seen_row=seen_in_file[idx_raw],
                    )
                )
                continue
            seen_in_file[idx_raw] = excel_row

            # Read every cell once, so NaN-coercion warnings are reported once.
            values = {h: ctx.val(h) for h in headers if h is not None}

            if all(v is None for h, v in values.items() if h != "Index"):
                report.add(
                    BlrEmptyRowEntry(
                        loc=ctx.loc("Index"),
                        note="Rij bevat alleen een index; overgeslagen.",
                        blr_index=idx_raw,
                    )
                )
                continue

            if values.get("Word") is None:
                report.add(
                    BlrMissingWordEntry(
                        loc=ctx.loc("Word"),
                        note="Geen Word ingevuld; reconstructie wordt toch geïmporteerd.",
                        blr_index=idx_raw,
                    )
                )

            contributor_name = values.get("Added by")
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

            reliability_val = values.get("Fiab:")
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
                values.get("C1"),
                values.get("C2"),
                values.get("C3"),
                values.get("C4"),
                values.get("CS"),
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
                values.get("V11"),
                values.get("V12"),
                values.get("V21"),
                values.get("V22"),
                values.get("V3"),
                values.get("V4"),
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
                values.get("T11"),
                values.get("T12"),
                values.get("T21"),
                values.get("T22"),
                values.get("T3"),
                values.get("T4"),
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

            fields = {
                "word_tone": values.get("Word\\Tone"),
                "word": values.get("Word"),
                "english": values.get("English"),
                "french": values.get("Français:"),
                "noun_class": values.get("N class"),
                "distribution": values.get("Distr:"),
                "note": values.get("Note"),
                "proto_kk": values.get("Proto KK"),
                "date_of_entry": values.get("Date of entry"),
                "contributor_id": contributor.id if contributor else None,
                "reliability_id": reliability.id if reliability else None,
                "consonant_structure_id": (
                    consonant_structure.id if consonant_structure else None
                ),
                "vowel_structure_id": vowel_structure.id if vowel_structure else None,
                "tone_structure_id": tone_structure.id if tone_structure else None,
            }

            blr = existing_by_index.get(idx_raw)
            if blr is None:
                blr = Reconstruction(blr_index=idx_raw, **fields)
                session.add(blr)
                session.flush()
                existing_by_index[idx_raw] = blr
                inserted += 1
            else:
                for name, value in fields.items():
                    setattr(blr, name, value)
                updated += 1

        session.commit()
        logger.info(
            f"BLR import done — {inserted} new entries inserted, {updated} updated."
        )

        # Link Reflex.blr_entry_id via Reflex.blr_index (integer match)
        blr_index_map = {idx: rec.id for idx, rec in existing_by_index.items()}
        linked = 0
        unresolved = 0
        for reflex in session.exec(
            select(Reflex).where(
                Reflex.blr_index.is_not(None),
                Reflex.blr_entry_id.is_(None),
            )
        ).all():
            # No spreadsheet row here: this phase iterates DB Reflex rows.
            link_loc = SourceLocation(file_name, sheet_name, None, "BLR Index", None)
            try:
                idx = int(reflex.blr_index)
            except (ValueError, TypeError):
                unresolved += 1
                report.add(
                    BlrUnresolvedLinkEntry(
                        loc=link_loc,
                        note="BLR index kon niet als integer worden geparsed.",
                        reflex_id=reflex.id,
                        blr_index_raw=reflex.blr_index,
                    )
                )
                continue
            blr_id = blr_index_map.get(idx)
            if blr_id:
                reflex.blr_entry_id = blr_id
                linked += 1
            else:
                unresolved += 1
                report.add(
                    BlrUnresolvedLinkEntry(
                        loc=link_loc,
                        note="Geen overeenkomende BLR Reconstruction gevonden voor dit index.",
                        reflex_id=reflex.id,
                        blr_index_raw=idx,
                    )
                )

        session.commit()
        logger.info(f"Linked {linked} entries to BLR — {unresolved} unresolved.")
