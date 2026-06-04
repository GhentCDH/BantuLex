import logging

from openpyxl import load_workbook
from sqlmodel import Session, SQLModel, select

from utilities.config import BLR_EXCEL
from utilities.db import engine, get_or_create
from utilities.model import (
    BLRConsonantStructure,
    BLRContributor,
    BLRReliability,
    BLRToneStructure,
    BLRVowelStructure,
    Reconstruction,
    Reflex,
)

from .parsing import clean_value, parse_int
from .report import ImportReport

logger = logging.getLogger(__name__)


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
        return {h: c.value for h, c in zip(headers, rc, strict=False) if h is not None}

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

            idx_raw = parse_int(row.get("Index"))
            if idx_raw is None:
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
