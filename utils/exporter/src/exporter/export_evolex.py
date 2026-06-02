"""
export_evolex.py - BantuLex DB -> EvoLex Excel export  (GECORRIGEERDE VERSIE)

Output: evolex_export.xlsx
  Sheet "CogSets"    : cogset-gegroepeerde data conform EvoLex template (20 kolommen)
  Sheet "Lg-metadata": een rij per taalvariant (5 kolommen)

MAPPING BantuLex -> EvoLex  CogSets  (20 kolommen)
Col  0  CogId              <- "BLR_{blr_index:04d}" (via Reconstruction.blr_index)
                              ongelinkt: "UNL_{beginning_id:06d}"
Col  1  pr-language        <- leeg  (proto-taalsubgroep; niet in model)
Col  2  root               <- Reconstruction.word
Col  3  etymon             <- Reconstruction.word_tone  (proto-vorm met toon)
Col  4  pr-gloss           <- Reconstruction.english
Col  5  picture-URL        <- leeg
Col  6  pic-caption        <- leeg
Col  7  cogset-note        <- Reconstruction.note
Col  8  lg_code            <- Variety.guthrie_index  (fallback: bastin_index)
Col  9  lg_name            <- Variety.name_english
Col 10  form_IPA           <- Reflex.ipa
Col 11  form-orthog        <- Reflex.term
Col 12  pos                <- Reflex.part_of_speech
Col 13  definition-evolex  <- Reflex.meaning
Col 14  glosses-evosem     <- leeg  (semantische gloss voor Evosem; niet in model)
Col 15  orig_gloss         <- Reflex.translation  (gloss zoals in originele bron)
Col 16  source             <- Source.author_year  (primaire bron)
Col 17  page               <- SourceEntries.pages
Col 18  public_note_reflex <- Reflex.notes
Col 19  comment            <- leeg  (intern; niet in model)

MAPPING BantuLex -> EvoLex  Lg-metadata  (5 kolommen)
Col 0  Our_code   <- Variety.guthrie_index  (fallback: bastin_index)
Col 1  Lg-name    <- Variety.name_english
Col 2  glottocode <- leeg  (niet in model)
Col 3  latitude   <- Coordinate.latitude   (float, description='default')
Col 4  longitude  <- Coordinate.longitude  (float, description='default')

BEKENDE HIATEN  (BantuLex heeft het niet, EvoLex verwacht het wel)
  lg_code / Our_code : guthrie_index gebruikt als korte code; mogelijks handmatige
                       correctie nodig (Guthrie-codes zijn bv. "C30", niet "kar")
  pr-language        : proto-taalsubgroep -- niet opgeslagen
  glosses-evosem     : vereenvoudigde semantische gloss -- niet opgeslagen
  glottocode         : niet opgeslagen
  picture-URL / cap  : niet opgeslagen
  comment            : intern; niet nodig

STRUCTUREEL VERSCHIL  oud vs. nieuw
  OUD: "Data" (29 kolommen, 2 headerrijen) + "Languages" + "References"
  NIEUW: "CogSets" (20 kolommen, 1 headerrij) + "Lg-metadata"

  CogSets groepeert reflexes per Reconstruction (blr_entry_id):
    - Eerste rij van elke groep: CogId + proto-velden (col 0-7) ingevuld.
    - Volgende rijen: col 0-7 leeg (conform Excel-groepering in template).
    - Reflexes zonder Reconstruction -> aparte "UNL_" cogsets onderaan.

  Coordinaten: raw float in Lg-metadata (niet de "X.XX N/S" string).
"""

import argparse
import logging
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from rich.logging import RichHandler
from sqlalchemy.orm import joinedload
from sqlmodel import Session, select

from utilities.config import EXPORT_EVOLEX_EXCEL
from utilities.db import engine
from utilities.model import Reconstruction, Reflex, Source, SourceEntries, Variety
from utilities.utils import load_default_coords, load_location_by_variety

# ---------------------------------------------------------------------------
# ⚙️  CONFIGURATIE  -  pas hier aan
# ---------------------------------------------------------------------------

GOOGLE_SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1O1kyVfKhCDWFA1c-XJocI3jiBqnaAjwf7QAk_1K2644/edit?usp=sharing"

GOOGLE_SERVICE_ACCOUNT_FILE = Path(__file__).parent / "service_account.json"
#
# Eenmalige setup voor Google Sheets:
#   1. Activeer Google Sheets API op https://console.cloud.google.com/
#   2. Maak een Service Account aan en download de JSON-sleutel.
#   3. Sla de sleutel op als het pad in GOOGLE_SERVICE_ACCOUNT_FILE.
#   4. Deel de spreadsheet met het 'client_email' uit de JSON als Bewerker.
#   5. pip install gspread

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

handler = RichHandler(rich_tracebacks=True, show_time=True, show_path=False)
logging.basicConfig(level=logging.INFO, format="%(message)s", handlers=[handler])
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constanten
# ---------------------------------------------------------------------------

COGSETS_HEADERS = [
    "CogId",
    "pr-language",
    "root",
    "etymon",
    "pr-gloss",
    "picture-URL",
    "pic-caption",
    "cogset-note",
    "lg_code",
    "lg_name",
    "form_IPA",
    "form-orthog",
    "pos",
    "definition-evolex",
    "glosses-evosem",
    "orig_gloss",
    "source",
    "page",
    "public_note_reflex",
    "comment",
]

LG_METADATA_HEADERS = ["Our_code", "Lg-name", "glottocode", "latitude", "longitude"]

COGSETS_COL_WIDTHS = [
    12,
    12,
    12,
    12,
    28,
    30,
    25,
    30,
    12,
    28,
    15,
    22,
    8,
    38,
    22,
    28,
    15,
    8,
    32,
    20,
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _lg_code(variety: Variety | None) -> str | None:
    """
    Geeft de beste beschikbare korte taalcode.
    Voorkeur: guthrie_index > bastin_index > None.

    NOTE: Guthrie-codes zijn zone+nummer (bv. "C30"), geen 3-letter afkortingen
    zoals in het EvoLex-voorbeeld ("kar", "tat"). Als de EvoLex-beheerder een
    aparte korte-code kolom wil, voeg dan 'short_code' toe aan het Variety-model.
    """
    if variety is None:
        return None
    return variety.guthrie_index or variety.bastin_index or None


def _style_header_row(ws, row_num: int) -> None:
    from openpyxl.styles import Alignment, Font, PatternFill

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(
        start_color="4F81BD", end_color="4F81BD", fill_type="solid"
    )
    for cell in ws[row_num]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")


# ---------------------------------------------------------------------------
# Sheet: CogSets
# ---------------------------------------------------------------------------


def build_cogsets_sheet(
    ws,
    entries: list[Reflex],
    source_by_entry: dict[int, Source | None],
    pages_by_entry: dict[int, str | None],
    reconstructions_map: dict[int, Reconstruction],
) -> None:
    """
    CogSets: één headerrij + cogset-gegroepeerde datarijen (conform EvoLex template).

    Groepering:
      - Reflexes met blr_entry_id  -> gegroepeerd per Reconstruction, gesorteerd op blr_index.
      - Reflexes zonder blr_entry_id -> aparte "UNL_" eenrij-cogsets achteraan.

    Eerste rij per cogset: CogId + proto-velden (col 0-7) ingevuld.
    Volgende rijen: col 0-7 leeg.
    """
    ws.title = "CogSets"
    ws.append(COGSETS_HEADERS)
    _style_header_row(ws, 1)

    grouped: dict[int | None, list[Reflex]] = defaultdict(list)
    for entry in entries:
        grouped[entry.blr_entry_id].append(entry)

    def _write_cogset(
        cog_id: str,
        recon: Reconstruction | None,
        group: list[Reflex],
    ) -> None:
        first_row = True
        for entry in group:
            source = source_by_entry.get(entry.id)
            variety = entry.variety

            # Kolommen 0-7: alleen in de eerste rij van de cogset
            if first_row:
                proto_cols: list[Any] = [
                    cog_id,  # CogId
                    None,  # pr-language (niet in model)
                    recon.word if recon else None,  # root
                    recon.word_tone if recon else None,  # etymon
                    recon.english if recon else None,  # pr-gloss
                    None,  # picture-URL
                    None,  # pic-caption
                    recon.note if recon else None,  # cogset-note
                ]
                first_row = False
            else:
                proto_cols = [None] * 8  # Col 0-7 leeg voor volgende rijen

            # Kolommen 8-19: per reflex
            reflex_cols: list[Any] = [
                _lg_code(variety),  # lg_code
                variety.name_english if variety else None,  # lg_name
                entry.ipa,  # form_IPA
                entry.term,  # form-orthog
                entry.part_of_speech,  # pos
                entry.meaning,  # definition-evolex
                None,  # glosses-evosem (niet in model)
                entry.translation,  # orig_gloss
                source if source else None,  # source
                pages_by_entry.get(entry.id),  # page
                entry.notes,  # public_note_reflex
                None,  # comment (niet in model)
            ]
            ws.append(proto_cols + reflex_cols)

    # 1. Gelinkte cogsets -- gesorteerd op blr_index
    linked_groups = [
        (blr_id, group) for blr_id, group in grouped.items() if blr_id is not None
    ]
    linked_groups.sort(
        key=lambda kv: (
            reconstructions_map[kv[0]].blr_index or 0
            if kv[0] in reconstructions_map
            else 0
        )
    )
    for blr_id, group in linked_groups:
        recon = reconstructions_map.get(blr_id)
        if recon and recon.blr_index is not None:
            cog_id = f"BLR_{recon.blr_index:04d}"
        elif recon:
            cog_id = f"BLR_UNKNOWN_{blr_id}"
        else:
            cog_id = f"BLR_MISSING_{blr_id}"
        _write_cogset(cog_id, recon, group)

    for i, w in enumerate(COGSETS_COL_WIDTHS):
        ws.column_dimensions[ws.cell(row=1, column=i + 1).column_letter].width = w


# ---------------------------------------------------------------------------
# Sheet: Lg-metadata
# ---------------------------------------------------------------------------


def build_lg_metadata_sheet(
    ws,
    varieties: list[Variety],
    coord_by_location: dict[int, tuple[float | None, float | None]],
    location_by_variety: dict[int, int | None],
) -> None:
    """
    Lg-metadata: één headerrij + een rij per unieke variety.

    Coordinaten als raw float (niet de "X.XX N/S" string die de oude export gebruikte).
    Our_code = guthrie_index (of bastin_index als fallback).
    """
    ws.title = "Lg-metadata"
    ws.append(LG_METADATA_HEADERS)
    _style_header_row(ws, 1)

    seen: set = set()
    for v in varieties:
        key = (_lg_code(v), v.name_english)
        if key in seen:
            continue
        seen.add(key)

        loc_id = location_by_variety.get(v.id)
        lat, lon = (
            coord_by_location.get(loc_id, (None, None))
            if loc_id is not None
            else (None, None)
        )
        ws.append(
            [
                _lg_code(v),  # Our_code
                v.name_english,  # Lg-name
                None,  # glottocode (niet in model)
                lat,  # latitude (raw float)
                lon,  # longitude (raw float)
            ]
        )

    for col, width in zip("ABCDE", [15, 32, 15, 12, 12], strict=True):
        ws.column_dimensions[col].width = width


# ---------------------------------------------------------------------------
# Google Sheets integratie
# ---------------------------------------------------------------------------


def push_to_google_sheets(wb: Workbook, mode: str) -> None:
    """
    Schrijft de werkboekinhoud naar GOOGLE_SPREADSHEET_URL via GOOGLE_SERVICE_ACCOUNT_FILE.

    mode='overwrite' : wist en herschrijft elk tabblad volledig.
    mode='append'    : voegt alleen nieuwe datarijen toe (headerrij overgeslagen).
    """
    try:
        import gspread
        from gspread.exceptions import SpreadsheetNotFound, WorksheetNotFound
    except ImportError:
        logger.error("gspread niet gevonden. Installeer via: pip install gspread")
        return

    try:
        gc = gspread.service_account(filename=GOOGLE_SERVICE_ACCOUNT_FILE)
    except FileNotFoundError:
        logger.error(
            f"Service account JSON niet gevonden: {GOOGLE_SERVICE_ACCOUNT_FILE!r}\n"
            "Pas GOOGLE_SERVICE_ACCOUNT_FILE bovenaan het script aan."
        )
        return

    try:
        spreadsheet = gc.open_by_url(GOOGLE_SPREADSHEET_URL)
    except SpreadsheetNotFound:
        logger.error(
            f"Spreadsheet niet bereikbaar: {GOOGLE_SPREADSHEET_URL}\n"
            "Controleer of het 'client_email' is toegevoegd als Bewerker."
        )
        return

    logger.info(f"[Sheets] Verbonden: {spreadsheet.title!r}")

    for sheet_name in [sheet.title for sheet in wb.worksheets]:
        ws_xls = wb[sheet_name]
        all_rows: list[list[Any]] = [
            [v if v is not None else "" for v in row]
            for row in ws_xls.iter_rows(values_only=True)
        ]

        try:
            gws = spreadsheet.worksheet(sheet_name)
        except WorksheetNotFound:
            gws = spreadsheet.add_worksheet(
                title=sheet_name,
                rows=max(len(all_rows) + 100, 1000),
                cols=max(len(all_rows[0]) if all_rows else 20, 20),
            )
            logger.info(f"[Sheets] Tabblad '{sheet_name}' aangemaakt.")

        if mode == "overwrite":
            gws.clear()
            if all_rows:
                batch_size = 5000
                total_batches = (len(all_rows) + batch_size - 1) // batch_size
                for i in range(0, len(all_rows), batch_size):
                    batch = all_rows[i : i + batch_size]
                    range_name = f"A{i + 1}"
                    gws.update(values=batch, range_name=range_name)

                    logger.info(
                        f"[Sheets] '{sheet_name}' batch {i // batch_size + 1}/{total_batches} verzonden."
                    )
                    # Voorkom "Quota exceeded" errors
                    time.sleep(1)
            logger.info(f"[Sheets] OVERWRITE '{sheet_name}' voltooid.")
        elif mode == "append":
            data_rows = all_rows[1:]  # Sla headerrij over
            if data_rows:
                gws.append_rows(data_rows, value_input_option="RAW")
                logger.info(f"[Sheets] APPEND '{sheet_name}': {len(data_rows)} rijen.")
            else:
                logger.warning(f"[Sheets] Geen datarijen voor '{sheet_name}'.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(mode: str = "local") -> None:
    """
    mode='local'     : alleen lokale .xlsx aanmaken.
    mode='overwrite' : lokale .xlsx + Google Sheets volledig overschrijven.
    mode='append'    : lokale .xlsx + nieuwe rijen toevoegen aan Google Sheets.
    """
    logger.info(f"BantuLex -> EvoLex export gestart  [modus: {mode}]")
    EXPORT_EVOLEX_EXCEL.parent.mkdir(parents=True, exist_ok=True)

    with Session(engine, expire_on_commit=False) as session:
        entries: list[Reflex] = list(
            session.exec(
                select(Reflex)
                .where(Reflex.blr_entry_id.is_not(None))
                .options(joinedload(Reflex.variety))
            ).all()
        )
        logger.info(f"Reflexes geladen (enkel met BLR-link): {len(entries)}")

        source_by_entry: dict[int, str | None] = {}
        pages_by_entry: dict[int, str | None] = {}
        sources_map: dict[int, Source] = {
            s.id: s for s in session.exec(select(Source)).all()
        }
        # Collect all primary sources per entry, sorted by order
        entry_sources = defaultdict(list)
        for link in session.exec(
            select(SourceEntries)
            .where(SourceEntries.role == "primary")
            .order_by(SourceEntries.entry_id, SourceEntries.order)
        ).all():
            source = sources_map.get(link.source_id)
            if source:
                entry_sources[link.entry_id].append((source.author_year, link.pages))

        for entry_id, items in entry_sources.items():
            # Join multiple sources: "Author A 2000; Author B 2005"
            source_by_entry[entry_id] = "; ".join(filter(None, [it[0] for it in items]))
            pages_by_entry[entry_id] = "; ".join(filter(None, [it[1] for it in items]))

        reconstructions_map: dict[int, Reconstruction] = {
            r.id: r for r in session.exec(select(Reconstruction)).all()
        }
        logger.info(f"Reconstructions geladen: {len(reconstructions_map)}")

        coord_by_location = load_default_coords(session)
        location_by_variety = load_location_by_variety(entries)
        varieties: list[Variety] = list(session.exec(select(Variety)).all())

        wb = Workbook()
        build_cogsets_sheet(
            wb.active, entries, source_by_entry, pages_by_entry, reconstructions_map
        )
        ws_lg = wb.create_sheet()
        build_lg_metadata_sheet(
            ws_lg, varieties, coord_by_location, location_by_variety
        )

    wb.save(EXPORT_EVOLEX_EXCEL)
    logger.info(f"Lokaal opgeslagen: {EXPORT_EVOLEX_EXCEL}")

    linked = sum(1 for e in entries if e.blr_entry_id is not None)
    unlinked = len(entries) - linked
    n_varieties = len({(_lg_code(v), v.name_english) for v in varieties})
    logger.info(
        f"  CogSets    : {linked} gelinkte reflexes | {unlinked} ongelinkte reflexes"
    )
    logger.info(f"  Lg-metadata: {n_varieties} unieke varieties")

    if mode in ("overwrite", "append"):
        push_to_google_sheets(wb, mode)

    logger.info("Export klaar.")


def main_google_overwrite():
    """Wrapper voor entry-point: overschrijf Google Sheets."""
    main(mode="overwrite")


def main_google_append():
    """Wrapper voor entry-point: voeg toe aan Google Sheets."""
    main(mode="append")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="BantuLex -> EvoLex export  (lokaal .xlsx + optioneel Google Sheets)"
    )
    parser.add_argument(
        "--mode",
        choices=["local", "overwrite", "append"],
        default="local",
        help=(
            "local     : alleen .xlsx opslaan (standaard).\n"
            "overwrite : .xlsx + Google Sheets volledig overschrijven.\n"
            "append    : .xlsx + nieuwe rijen toevoegen aan Google Sheets."
        ),
    )
    args = parser.parse_args()
    main(mode=args.mode)
