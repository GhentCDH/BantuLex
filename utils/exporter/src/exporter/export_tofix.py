"""
export_tofix.py  -  import report → data/to_fix.html (worklist for the admin)

Reads the importer's report (import_validation.json), its Excel row → reflex
map (import_rows.json) and the database, groups the actionable entries and
embeds them in a single static HTML page. Each item links to the record in
the Crouton admin; progress is kept in the browser's localStorage.

Left out on purpose: whitespace notes (already stripped on import) and rows
without any data (Excel padding).

Gebruik:
  uv run export-tofix
"""

import json
import logging
from collections import defaultdict
from datetime import date
from importlib.resources import files
from typing import Any

from rich.logging import RichHandler
from sqlalchemy import text

from utilities.config import DATA_ROOT
from utilities.db import engine

handler = RichHandler(rich_tracebacks=True, markup=True, show_time=True, show_path=True)
logging.basicConfig(level=logging.INFO, format="%(message)s", handlers=[handler])
logger = logging.getLogger(__name__)

REPORT = DATA_ROOT / "import_validation.json"
ROWS = DATA_ROOT / "import_rows.json"
OUTPUT = DATA_ROOT / "to_fix.html"

# Category → (title, what to do). Order is the order in the page.
CATEGORIES: dict[str, tuple[str, str]] = {
    "duplicate_beginning_id": (
        "Duplicate ID beginning",
        "Split rows shared an ID beginning; this reflex was imported without one. Give it a new, unique beginning ID.",
    ),
    "blr_unresolved_link": (
        "BLR index without reconstruction",
        "The BLR index is not in BLR.xlsx. Correct the index on the reflex, or add the reconstruction.",
    ),
    "skipped_no_term": (
        "Row without term (not imported)",
        "The Excel row has data but no term, so it is not in the database. Fix it in the Excel.",
    ),
    "blr_text_to_note": (
        "BLR index is not a number",
        "The text was moved to 'Blr note' and the reflex is not linked. Once checked, put the number in 'Blr index'.",
    ),
    "suspicious_duplicate": (
        "Possible duplicate reflex",
        "Same term and variety as an earlier row. Delete one of the two, or leave both if they are distinct.",
    ),
    "coordinate_conflict": (
        "Conflicting coordinates",
        "Rows for the same location give different coordinates; the first one was kept. Check the coordinate.",
    ),
    "uncertainty": (
        "Uncertain value",
        "Question marks were stripped from the value. Check it, and correct the value if needed.",
    ),
    "source_incomplete": (
        "Source without title",
        "The source has an author/year but no title (or the other way round). Complete the source.",
    ),
    "case_variant": (
        "Variety capitalisation",
        "The same variety exists twice, differing only in capitals. Merge them into one.",
    ),
    "blr_ipv_resolved": (
        "BLR 'ipv' resolved",
        "'X ipv Y' was read as X and linked. Check that X is the right index.",
    ),
    "nan_coercion": (
        "'NaN' read as empty",
        "The cell said 'NaN' and was stored as empty. Check BLR.xlsx.",
    ),
}
# Shown as low priority, regardless of the report level.
INFO = {"blr_ipv_resolved", "nan_coercion"}


def link(label: str, resource: str, id_: int | None = None, q: str | None = None) -> list:
    return [label, resource, id_, q]


def build_items(report: dict, row_reflex: dict[int, int]) -> list[dict[str, Any]]:
    with engine.connect() as c:
        reflex = {
            r.id: r
            for r in c.execute(
                text("SELECT id, term, location_id, variety_id FROM reflex")
            )
        }
        coordinate = {
            (r.location_id, r.description): r.id
            for r in c.execute(text("SELECT id, location_id, description FROM coordinate"))
        }
        location_name = {
            r.id: r.name
            for r in c.execute(
                text(
                    "SELECT l.id, concat_ws(', ', p.name, r.name, c.name) AS name FROM location l "
                    "LEFT JOIN place p ON p.id = l.place_id LEFT JOIN region r ON r.id = l.region_id "
                    "LEFT JOIN country c ON c.id = l.country_id"
                )
            )
        }
        source_by_author = defaultdict(list)
        for r in c.execute(text("SELECT id, author_year, title FROM source")):
            source_by_author[r.author_year].append(r)
        year_by_value = defaultdict(list)
        for r in c.execute(text("SELECT id, value, status FROM collectionyear")):
            year_by_value[r.value].append(r)
        variety_by_name = defaultdict(list)
        for r in c.execute(text("SELECT id, name_english, guthrie_index FROM variety")):
            variety_by_name[(r.name_english or "").lower()].append(r)

    items: list[dict[str, Any]] = []

    def add(cat: str, key: str, title: str, detail: str, excel: str, links: list, rows: int = 1):
        level = "info" if cat in INFO else entries_level[cat]
        items.append(
            {"i": f"{cat}:{key}", "c": cat, "v": level, "t": title, "d": detail,
             "x": excel, "n": rows, "l": [lk for lk in links if lk]}
        )

    def reflex_link(row: int | None, label: str = "Reflex") -> list | None:
        rid = row_reflex.get(row) if row else None
        return link(label, "reflex", rid) if rid else None

    entries_level = {cat: (report.get(cat) or [{}])[0].get("level", "warning") for cat in CATEGORIES}

    for e in report.get("duplicate_beginning_id", []):
        loc = e["location"]
        add("duplicate_beginning_id", loc["cell"], f"{e.get('term')} · {e.get('variety_english')}",
            f"ID beginning {e['beginning_id']} was already used in row {e['first_seen_row']}.",
            loc["cell"], [reflex_link(loc["row"], "This reflex (no ID)"),
                          reflex_link(e["first_seen_row"], "Reflex with the ID")])

    for e in report.get("blr_unresolved_link", []):
        r = reflex.get(e["reflex_id"])
        add("blr_unresolved_link", str(e["reflex_id"]), f"{r.term if r else '?'} · BLR {e['blr_index_raw']}",
            f"No reconstruction with BLR index {e['blr_index_raw']}.", "",
            [link("Reflex", "reflex", e["reflex_id"])])

    for e in report.get("skipped_no_term", []):
        if not e.get("variety_english"):  # Excel padding: nothing but the row number
            continue
        loc = e["location"]
        add("skipped_no_term", loc["cell"], f"{e.get('variety_english')} ({e.get('guthrie_index') or '?'})",
            f"Row {loc['row']} has no term. Country: {e.get('country') or '?'}.", loc["cell"], [])

    for e in report.get("blr_text_to_note", []):
        loc = e["location"]
        add("blr_text_to_note", loc["cell"], f"{e.get('term')} · {e.get('variety_english')}",
            f"BLR index text: “{e['blr_index_raw']}”", loc["cell"], [reflex_link(loc["row"])])

    for e in report.get("suspicious_duplicate", []):
        loc = e["location"]
        add("suspicious_duplicate", loc["cell"], f"{e.get('term')} · {e.get('variety_english')}",
            f"Also in row {e['first_seen_row']} ({e.get('guthrie_index') or '?'}).", loc["cell"],
            [reflex_link(loc["row"], "This reflex"), reflex_link(e["first_seen_row"], "Earlier reflex")])

    # One item per location, coordinate type and conflicting value.
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for e in report.get("coordinate_conflict", []):
        r = reflex.get(row_reflex.get(e["location"]["row"], -1))
        loc_id = r.location_id if r else None
        groups[(loc_id, e["coord_type"], e["new_lat"], e["new_lon"])].append(e)
    for (loc_id, kind, lat, lon), es in groups.items():
        e = es[0]
        cid = coordinate.get((loc_id, kind))
        name = location_name.get(loc_id) or e.get("place") or e.get("country") or "?"
        add("coordinate_conflict", f"{loc_id}:{kind}:{lat}:{lon}", f"{name} · {kind}",
            f"Kept {e['existing_lat']}, {e['existing_lon']} (row {e['conflicting_row']}); "
            f"{len(es)} row(s) give {lat}, {lon}. Example: {e.get('term')} · {e.get('variety_english')}.",
            es[0]["location"]["cell"] + (f" +{len(es) - 1}" if len(es) > 1 else ""),
            [link("Coordinate", "coordinate", cid) if cid else None,
             link("Location", "location", loc_id) if loc_id else None,
             reflex_link(e["location"]["row"], "Example reflex")], rows=len(es))

    groups = defaultdict(list)
    for e in report.get("uncertainty", []):
        groups[(e["location"]["column"], str(e["original_value"]))].append(e)
    for (column, value), es in groups.items():
        e = es[0]
        resource = "collectionyear" if column == "Year of collection" else "source"
        cleaned = e.get("cleaned_value")
        if resource == "collectionyear":
            records = [link(f"Year {y.value} ({y.status})", "collectionyear", y.id)
                       for y in year_by_value.get(cleaned, [])]
        else:
            records = [link(f"Source #{x.id}", "source", x.id) for x in source_by_author.get(cleaned, [])]
        add("uncertainty", f"{column}:{value}", f"“{value}”",
            f"{column}: read as “{cleaned or '(empty)'}” in {len(es)} row(s).",
            e["location"]["cell"] + (f" +{len(es) - 1}" if len(es) > 1 else ""),
            [*records, reflex_link(e["location"]["row"], "Example reflex")], rows=len(es))

    groups = defaultdict(list)
    for e in report.get("source_incomplete", []):
        groups[(e["author_year_value"], e["title_value"])].append(e)
    for (author, title), es in groups.items():
        e = es[0]
        add("source_incomplete", f"{author}:{title}", f"{author}",
            f"Title: {title}. {e['author_year_column']}, {len(es)} row(s).",
            e["location"]["cell"] + (f" +{len(es) - 1}" if len(es) > 1 else ""),
            [*(link(f"Source #{s.id}", "source", s.id)
               for s in source_by_author.get(author.rstrip("?").strip(), []) if not s.title),
             reflex_link(e["location"]["row"], "Example reflex")], rows=len(es))

    groups = defaultdict(list)
    for e in report.get("case_variant", []):
        groups[(e["entity"], e["new_value"], e["existing_value"])].append(e)
    for (entity, new, existing), es in groups.items():
        name = new.split(" | ")[0]
        found = variety_by_name.get(name.lower(), [])
        add("case_variant", f"{entity}:{new}:{existing}", name,
            f"“{new}” vs. “{existing}” ({len(es)} row(s)).",
            es[0]["location"]["cell"] + (f" +{len(es) - 1}" if len(es) > 1 else ""),
            [link(f"Variety #{v.id} ({v.guthrie_index or '?'})", "variety", v.id) for v in found],
            rows=len(es))

    for e in report.get("blr_ipv_resolved", []):
        loc = e["location"]
        add("blr_ipv_resolved", loc["cell"], f"{e.get('term')} · {e.get('variety_english')}",
            f"“{e['blr_index_raw']}” → {e['blr_index_used']}", loc["cell"], [reflex_link(loc["row"])])

    for e in report.get("nan_coercion", []):
        loc = e["location"]
        add("nan_coercion", f"{loc['file']}:{loc['cell']}", f"{loc['file']} {loc['cell']}",
            f"Column {loc['column']}: “{e['original_value']}” stored as empty.", loc["cell"], [])

    return items


def main() -> None:
    report = json.loads(REPORT.read_text())
    row_reflex = {int(k): v for k, v in json.loads(ROWS.read_text()).items()}
    items = build_items(report, row_reflex)
    payload = {
        "generated": date.today().isoformat(),
        "categories": [
            {"id": cat, "title": t, "help": h} for cat, (t, h) in CATEGORIES.items()
        ],
        "items": items,
    }
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    template = files("exporter").joinpath("to_fix.html").read_text(encoding="utf-8")
    OUTPUT.write_text(template.replace("/*__DATA__*/null", data), encoding="utf-8")
    counts = defaultdict(int)
    for it in items:
        counts[it["c"]] += 1
    for cat in CATEGORIES:
        logger.info(f"  {cat}: {counts[cat]}")
    logger.info(f"Saved {len(items)} items to {OUTPUT} ({OUTPUT.stat().st_size / 1e6:.1f} MB)")
