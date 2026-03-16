"""
export_to_evolex.py  –  BantuLex DB → EvoLex Excel export

Richting:  BantuLex PostgreSQL (via model.py) → EvoLex spreadsheet formaat
Output:    evolex_export.xlsx   (Data + Languages + References sheets)

Sheet layout (EvoLex conventie):
  Data       : rij 1 = korte Excel-labels, rij 2 = canonieke EvoLex-namen, rij 3+ = data
  Languages  : rij 1 = headers, rij 2+ = één rij per unieke taalvariant
  References : rij 1 = headers, rij 2+ = één rij per unieke bron

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MAPPING  BantuLex model  →  EvoLex kolom
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DIRECT 1-op-1
  Entry.ipa                  →  Data[12]  Reflex_IPA
  Entry.term                 →  Data[13]  Ortho
  Entry.semantic_field       →  Data[15]  Semantic field
  Entry.translation          →  Data[16]  Dict_entry
  Entry.part_of_speech       →  Data[17]  POS
  Entry.term_morph_analysis  →  Data[18]  Morph
  Entry.meaning              →  Data[22]  final version of definition for EvoLex (all in English)
  Entry.notes                →  Data[23]  note for each reflex (row)
  Source.author_year         →  Data[24]  Source
                             →  References[0]  abbrev
  Source.pages               →  Data[27]  page number in column "Source" (as printed on page)
  Source.title               →  References[2]  full ref
  Variety.name_english       →  Data[9]   Language
                             →  Languages[2]  Language/Dialect
  Variety.branch             →  Languages[0]  Subgroup
  Coordinate.latitude        →  Languages[5]  Latitude   (float → "X.XX N/S")
  Coordinate.longitude       →  Languages[6]  Longitude  (float → "X.XX E/W")

LEEG IN EXPORT (EvoLex verwacht, BantuLex heeft niet)
  Data[0]   CogId
  Data[1]   Family
  Data[2]   Root
  Data[3]   Etymon
  Data[4]   Protogloss
  Data[7]   public note for whole etymon / entry
  Data[8]   Language cluster
  Data[10]  Isocode
  Data[11]  Glottocode
  Data[14]  lit.
  Data[19]  ES_Gloss
  Data[20]  Dict_Ortho
  Data[21]  dictionary data [AS]
  Data[25]  Questions and notes [AS]
  Data[26]  Answers to questions (col Z)
  Data[28]  page number in PDF of dictionary source [single number]
  Languages[1]  Language Cluster
  Languages[3]  Iso
  Languages[4]  Glotto
  References[1]  URL of pdf for future user

VALT WEG (BantuLex heeft, geen EvoLex kolom voor)
  Entry.original_id, Entry.beginning_id, Entry.scientific_name, Entry.blr_index
  Variety.name_french, .name_bantu, .name_bastin, .bastin_index,
          .guthrie_index, .guthrie_plus, .substrate_suspect
  Country.name, Region.name, Place.name
  Fieldwork.project_id, .collection_year_id, .consultants, .archive, .data_entered_by
  Source.year_uncertain
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from rich.logging import RichHandler
from sqlmodel import Session, select

from utilities.config import EXPORT_EVOLEX_EXCEL
from utilities.db import engine
from utilities.model import (
    Entry, Source, SourceEntries, Variety,
)
from utilities.utils import load_default_coords, load_location_by_variety


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

def fmt_coord(value: Optional[float], axis: str) -> Optional[str]:
    """
    Zet een signed float om naar EvoLex coordinate-notatie.
      axis='lat': positief → 'N', negatief → 'S'   bv. -15.8 → "15.8 S"
      axis='lon': positief → 'E', negatief → 'W'   bv.  11.85 → "11.85 E"
    """
    if value is None:
        return None
    direction = ("N" if value >= 0 else "S") if axis == "lat" else ("E" if value >= 0 else "W")
    return f"{abs(value)} {direction}"


def _style_header_row(ws, row_num: int) -> None:
    fill = PatternFill(start_color="D9D9D9", end_color="D9D9D9", fill_type="solid")
    for cell in ws[row_num]:
        if cell.value is not None:
            cell.font = Font(bold=True)
            cell.fill = fill
            cell.alignment = Alignment(wrap_text=True)


# ---------------------------------------------------------------------------
# Sheet builders
# ---------------------------------------------------------------------------

# ── Sheet: References ──

def build_references_sheet(ws, sources: List[Source]) -> None:
    """
    References[0]  abbrev              ← Source.author_year
    References[1]  URL of pdf          ← leeg (niet in model)
    References[2]  full ref            ← Source.title
    """
    ws.title = "References"
    ws.append(["abbrev", "URL of pdf for future user", "full ref"])
    _style_header_row(ws, 1)

    for source in sources:
        ws.append([
            source.author_year,  # References[0]  abbrev
            None,                # References[1]  URL of pdf for future user — leeg
            source.title,        # References[2]  full ref
        ])

    ws.column_dimensions["A"].width = 25
    ws.column_dimensions["B"].width = 40
    ws.column_dimensions["C"].width = 80


# ── Sheet: Languages ──

def build_languages_sheet(
    ws,
    varieties: List[Variety],
    coord_by_location: Dict[int, Tuple[Optional[float], Optional[float]]],
    location_by_variety: Dict[int, Optional[int]],
) -> None:
    """
    Languages[0]  Subgroup           ← Variety.branch
    Languages[1]  Language Cluster   ← leeg (niet in model)
    Languages[2]  Language/Dialect   ← Variety.name_english
    Languages[3]  Iso                ← leeg (niet in model)
    Languages[4]  Glotto             ← leeg (niet in model)
    Languages[5]  Latitude           ← Coordinate.latitude  (fmt_coord)
    Languages[6]  Longitude          ← Coordinate.longitude (fmt_coord)
    """
    ws.title = "Languages"
    ws.append(["Subgroup", "Language Cluster", "Language/Dialect",
               "Iso", "Glotto", "Latitude", "Longitude"])
    _style_header_row(ws, 1)

    seen: set = set()
    for v in varieties:
        key = (v.branch, v.name_english)
        if key in seen:
            continue
        seen.add(key)

        loc_id = location_by_variety.get(v.id)
        lat_raw, lon_raw = coord_by_location.get(loc_id, (None, None)) if loc_id else (None, None)

        ws.append([
            v.branch,                    # Languages[0]  Subgroup
            None,                        # Languages[1]  Language Cluster — leeg
            v.name_english,              # Languages[2]  Language/Dialect
            None,                        # Languages[3]  Iso — leeg
            None,                        # Languages[4]  Glotto — leeg
            fmt_coord(lat_raw, "lat"),   # Languages[5]  Latitude
            fmt_coord(lon_raw, "lon"),   # Languages[6]  Longitude
        ])

    for col, width in zip("ABCDEFG", [20, 20, 30, 10, 15, 12, 12]):
        ws.column_dimensions[col].width = width


# ── Sheet: Data ──

# Rij 1 (Excel-labels) en rij 2 (canonieke EvoLex-namen) identiek aan bronbestand
_DATA_ROW1_LABELS = [
    "bra", None, None, None, None,
    "picture (URL) (in https://__ or in pix/__)", "caption of picture",
    "public note for whole etymon / entry",
    "language or lg cluster", "lang / variety name",
    "iso", "glottoc.", None, "orig. orth.", "lit.",
    "Semantic field",
    "glosses [AMF] as meant to appear on EvoLex (unless colT)",
    "pos", "gender",
    "[AF, AS] simplified glosses for Evosem (when col Q or V would not be recognized as lemma)",
    "dictionary data [AS]: orthog of entry form",
    "dictionary data [AS]",
    "final version of definition for EvoLex (all in English)",
    "note for each reflex (row)", "Source",
    "Questions and notes [AS]",
    "Answers to questions (col Z) - see also this document",
    'page number in column "Source" (as printed on page)',
    "page number in PDF of dictionary source [single number]",
]

_DATA_ROW2_CANONICAL = [
    "CogId", "Family", "Root", "Etymon", "Protogloss",
    None, None, None,
    "Language cluster", "Language",
    "Isocode", "Glottocode", "Reflex_IPA", "Ortho",
    None, None, "Dict_entry", "POS", "Morph",
    "ES_Gloss", "Dict_Ortho", None, None, None,
    "Source", None, None, None, None,
]


def build_data_sheet(
    ws,
    entries: List[Entry],
    source_by_entry: Dict[int, Optional[Source]],
    pages_by_entry: Dict[int, Optional[str]],
) -> None:
    ws.title = "Data"
    ws.append(_DATA_ROW1_LABELS)
    ws.append(_DATA_ROW2_CANONICAL)
    _style_header_row(ws, 1)
    _style_header_row(ws, 2)

    for entry in entries:
        source  = source_by_entry.get(entry.id)
        variety = entry.variety

        ws.append([
            None,                                       # Data[0]   CogId — leeg
            None,                                       # Data[1]   Family — leeg
            None,                                       # Data[2]   Root — leeg
            None,                                       # Data[3]   Etymon — leeg
            None,                                       # Data[4]   Protogloss — leeg
            None,                                       # Data[5]   picture (URL) — leeg
            None,                                       # Data[6]   caption of picture — leeg
            None,                                       # Data[7]   public note for whole etymon / entry — leeg
            None,                                       # Data[8]   Language cluster — leeg
            variety.name_english if variety else None,  # Data[9]   Language
            None,                                       # Data[10]  Isocode — leeg
            None,                                       # Data[11]  Glottocode — leeg
            entry.ipa,                                  # Data[12]  Reflex_IPA
            entry.term,                                 # Data[13]  Ortho
            None,                                       # Data[14]  lit. — leeg
            entry.semantic_field,                       # Data[15]  Semantic field
            entry.translation,                          # Data[16]  Dict_entry
            entry.part_of_speech,                       # Data[17]  POS
            entry.term_morph_analysis,                  # Data[18]  Morph
            None,                                       # Data[19]  ES_Gloss — leeg
            None,                                       # Data[20]  Dict_Ortho — leeg
            None,                                       # Data[21]  dictionary data [AS] — leeg
            entry.meaning,                              # Data[22]  final version of definition for EvoLex (all in English)
            entry.notes,                                # Data[23]  note for each reflex (row)
            source.author_year if source else None,     # Data[24]  Source
            None,                                       # Data[25]  Questions and notes [AS] — leeg
            None,                                       # Data[26]  Answers to questions (col Z) — leeg
            pages_by_entry.get(entry.id),                                # Data[27]  page number in column "Source" (as printed on page)
            None,                                       # Data[28]  page number in PDF of dictionary source — leeg
        ])

    widths = [12,10,10,10,20, 20,20,30,20,25, 10,12,15,20,10,
              15,30,10,15,20, 20,20,40,30,25, 20,30,15,15]
    for i, w in enumerate(widths):
        ws.column_dimensions[ws.cell(row=1, column=i+1).column_letter].width = w


# ---------------------------------------------------------------------------
# Main export
# ---------------------------------------------------------------------------

def main() -> None:
    logger.info("BantuLex → EvoLex export gestart...")

    # We make sure the export directory exists
    EXPORT_EVOLEX_EXCEL.parent.mkdir(parents=True, exist_ok=True)

    with Session(engine, expire_on_commit=False) as session:

        entries  = session.exec(select(Entry)).all()
        logger.info(f"Entries geladen: {len(entries)}")

        # Primaire source per entry
        source_by_entry: Dict[int, Optional[Source]] = {}
        pages_by_entry: Dict[int, Optional[str]] = {}
        sources_map = {s.id: s for s in session.exec(select(Source)).all()}
        for link in session.exec(
            select(SourceEntries).where(SourceEntries.role == "primary")
        ).all():
            if link.entry_id not in source_by_entry:
                source_by_entry[link.entry_id] = sources_map.get(link.source_id)
                pages_by_entry[link.entry_id] = link.pages

        coord_by_location = load_default_coords(session)
        location_by_variety = load_location_by_variety(entries)

        varieties    = session.exec(select(Variety)).all()
        all_sources  = list(sources_map.values())

        wb = Workbook()

        build_data_sheet(wb.active, entries, source_by_entry, pages_by_entry)

        ws_lang = wb.create_sheet()
        build_languages_sheet(ws_lang, varieties, coord_by_location, location_by_variety)

        ws_ref = wb.create_sheet()
        build_references_sheet(ws_ref, all_sources)

        wb.save(EXPORT_EVOLEX_EXCEL)
        logger.info(f"Opgeslagen: {EXPORT_EVOLEX_EXCEL}")
        logger.info(f"  Data sheet:       {len(entries)} rijen")
        logger.info(f"  Languages sheet:  {len(set((v.branch, v.name_english) for v in varieties))} rijen")
        logger.info(f"  References sheet: {len(all_sources)} rijen")


if __name__ == "__main__":
    main()