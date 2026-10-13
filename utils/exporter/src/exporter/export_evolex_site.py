"""
export_evolex_site.py  -  EvoLex/EvoSem tables in the Pihka site database

Adds denormalised, indexed tables to site/database/bantulex.sqlite (the copy
that `just site-db` publishes) for the pages in site/evolex/. The browser reads
the database over HTTP range requests, so per-request work must stay small:
aggregates and joins are computed here once instead of in views.

  evolex_etyma        one row per BLR reconstruction, with reflex/variety counts
  evolex_etyma_zone   reconstruction × Guthrie zone (from `distribution`)
  evolex_reflex       linked reflexes with variety, coordinate and first source
  evolex_variety      varieties with one point (average default coordinate)
  evolex_source       sources with reflex/root counts
  evolex_sense        reconstruction × normalised English sense of its reflexes
  evolex_sense_pair   sense pairs shared by ≥ 2 reconstructions (EvoSem edges)

Gebruik:
  uv run evolex-site [path/to/site.sqlite]
"""

import logging
import os
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from itertools import combinations

from rich.logging import RichHandler

handler = RichHandler(rich_tracebacks=True, markup=True, show_time=True, show_path=True)
logging.basicConfig(level=logging.INFO, format="%(message)s", handlers=[handler])
logger = logging.getLogger(__name__)

DEFAULT_DB = os.getenv("EVOLEX_DB", "/app/site/database/bantulex.sqlite")
# Senses per reconstruction kept for the pair graph (the most frequent ones).
MAX_SENSES = 40

SCHEMA = """
DROP TABLE IF EXISTS evolex_etyma;
DROP TABLE IF EXISTS evolex_etyma_zone;
DROP TABLE IF EXISTS evolex_reflex;
DROP TABLE IF EXISTS evolex_variety;
DROP TABLE IF EXISTS evolex_source;
DROP TABLE IF EXISTS evolex_sense;
DROP TABLE IF EXISTS evolex_sense_pair;

CREATE TABLE evolex_etyma (
  id INTEGER PRIMARY KEY, blr_index INTEGER, word TEXT, word_tone TEXT,
  english TEXT, french TEXT, noun_class TEXT, distribution TEXT,
  reliability TEXT, contributor TEXT, note TEXT,
  reflexes INTEGER NOT NULL, varieties INTEGER NOT NULL, has_reflexes TEXT NOT NULL
);
CREATE TABLE evolex_etyma_zone (etyma_id INTEGER NOT NULL, zone TEXT NOT NULL);
CREATE TABLE evolex_reflex (
  id INTEGER PRIMARY KEY, reconstruction_id INTEGER NOT NULL, variety_id INTEGER,
  variety TEXT, guthrie TEXT, branch TEXT, term TEXT, morph TEXT, pos TEXT,
  meaning TEXT, translation TEXT, semantic_field TEXT, scientific_name TEXT,
  notes TEXT, source TEXT, source_id INTEGER, pages TEXT,
  latitude REAL, longitude REAL
);
CREATE TABLE evolex_variety (
  id INTEGER PRIMARY KEY, name TEXT, guthrie TEXT, guthrie_plus TEXT, branch TEXT,
  branch_detailed TEXT, reflexes INTEGER NOT NULL, latitude REAL, longitude REAL
);
CREATE TABLE evolex_source (
  id INTEGER PRIMARY KEY, author_year TEXT, title TEXT,
  reflexes INTEGER NOT NULL, roots INTEGER NOT NULL
);
CREATE TABLE evolex_sense (
  id INTEGER PRIMARY KEY, reconstruction_id INTEGER NOT NULL, sense TEXT NOT NULL,
  reflexes INTEGER NOT NULL, varieties INTEGER NOT NULL
);
CREATE TABLE evolex_sense_pair (
  sense_a TEXT NOT NULL, sense_b TEXT NOT NULL, weight INTEGER NOT NULL,
  PRIMARY KEY (sense_a, sense_b)
) WITHOUT ROWID;
"""

LATE_INDEXES = """
CREATE INDEX ix_evolex_etyma_blr ON evolex_etyma(blr_index);
CREATE INDEX ix_evolex_etyma_zone ON evolex_etyma_zone(zone, etyma_id);
CREATE INDEX ix_evolex_sense_root ON evolex_sense(reconstruction_id);
CREATE INDEX ix_evolex_sense_sense ON evolex_sense(sense, reconstruction_id);
"""

INDEXES = """
CREATE INDEX ix_evolex_reflex_root ON evolex_reflex(reconstruction_id);
CREATE INDEX ix_evolex_reflex_variety ON evolex_reflex(variety_id);
CREATE INDEX ix_evolex_reflex_source ON evolex_reflex(source_id);
"""

_SPLIT = re.compile(r"[;,/]")


def senses(meaning: str | None) -> list[str]:
    """Free-text English meaning → normalised sense labels ("to die; kill" → die, kill)."""
    out = []
    for part in _SPLIT.split(meaning or ""):
        s = re.sub(r"\([^)]*\)", "", part).strip().lower()
        s = re.sub(r"^to\s+", "", s)
        s = re.sub(r"\s+", " ", s).strip(" .?!'\"")
        # Trailing part-of-speech markers ("leg n.") are not part of the sense.
        s = re.sub(r"\s+(n|v|adj|adv|vt|vi|vtr|vintr|pl|sg)$", "", s)
        # Plain English only: forms typed into the meaning column ("gʊ́dʊ́") are skipped.
        if len(s) >= 2 and re.fullmatch(r"[a-z][a-z '\-]*", s):
            out.append(s)
    return out


def build(path: str) -> None:
    c = sqlite3.connect(path)
    c.executescript(SCHEMA)
    # sourceentries has no index on entry_id: pick each reflex's first primary
    # source once, into an indexed temp table, instead of a nested-loop join.
    c.executescript("""
        CREATE TEMP TABLE first_source AS
          SELECT entry_id, source_id, pages FROM sourceentries
          WHERE role = 'primary' AND "order" = 1;
        CREATE INDEX temp.ix_first_source ON first_source(entry_id);
        CREATE TEMP TABLE default_coord AS
          SELECT location_id, AVG(latitude) latitude, AVG(longitude) longitude
          FROM coordinate WHERE description = 'default' GROUP BY location_id;
        CREATE INDEX temp.ix_default_coord ON default_coord(location_id);
    """)

    c.execute("""
        INSERT INTO evolex_reflex
        SELECT r.id, r.blr_entry_id, r.variety_id, v.name_english, v.guthrie_index, v.branch,
               r.term, r.term_morph_analysis, r.part_of_speech, r.meaning, r.translation,
               r.semantic_field, r.scientific_name, r.notes,
               s.author_year, s.id, se.pages, co.latitude, co.longitude
        FROM reflex r
        LEFT JOIN variety v ON v.id = r.variety_id
        LEFT JOIN first_source se ON se.entry_id = r.id
        LEFT JOIN source s ON s.id = se.source_id
        LEFT JOIN default_coord co ON co.location_id = r.location_id
        WHERE r.blr_entry_id IS NOT NULL
    """)
    c.executescript(INDEXES)

    c.execute("""
        INSERT INTO evolex_etyma
        SELECT r.id, r.blr_index, r.word, r.word_tone, r.english, r.french, r.noun_class,
               r.distribution, rel.value, con.name, r.note,
               COALESCE(x.n, 0), COALESCE(x.v, 0), CASE WHEN x.n > 0 THEN 'yes' ELSE 'no' END
        FROM reconstruction r
        LEFT JOIN blrreliability rel ON rel.id = r.reliability_id
        LEFT JOIN blrcontributor con ON con.id = r.contributor_id
        LEFT JOIN (SELECT reconstruction_id, COUNT(*) n, COUNT(DISTINCT variety_id) v
                   FROM evolex_reflex GROUP BY reconstruction_id) x ON x.reconstruction_id = r.id
    """)
    zones = [
        (rid, z)
        for rid, dist in c.execute("SELECT id, distribution FROM evolex_etyma")
        for z in sorted(set(re.findall(r"[A-S]", dist or "")))
    ]
    c.executemany("INSERT INTO evolex_etyma_zone VALUES (?, ?)", zones)

    c.execute("""
        INSERT INTO evolex_variety
        SELECT v.id, v.name_english, v.guthrie_index, v.guthrie_plus, v.branch, v.branch_detailed,
               COALESCE(n.n, 0), p.lat, p.lon
        FROM variety v
        LEFT JOIN (SELECT variety_id, COUNT(*) n FROM reflex GROUP BY variety_id) n
               ON n.variety_id = v.id
        LEFT JOIN (SELECT r.variety_id, AVG(co.latitude) lat, AVG(co.longitude) lon
                   FROM (SELECT DISTINCT variety_id, location_id FROM reflex) r
                   JOIN default_coord co ON co.location_id = r.location_id
                   GROUP BY r.variety_id) p ON p.variety_id = v.id
    """)

    c.execute("""
        INSERT INTO evolex_source
        SELECT s.id, s.author_year, s.title, COALESCE(a.n, 0), COALESCE(b.n, 0)
        FROM source s
        LEFT JOIN (SELECT source_id, COUNT(*) n FROM sourceentries GROUP BY source_id) a
               ON a.source_id = s.id
        LEFT JOIN (SELECT source_id, COUNT(DISTINCT reconstruction_id) n
                   FROM evolex_reflex GROUP BY source_id) b ON b.source_id = s.id
    """)

    # Senses per reconstruction, from the English meaning of its reflexes.
    per_root: dict[int, Counter] = defaultdict(Counter)
    varieties: dict[tuple[int, str], set] = defaultdict(set)
    for rid, vid, meaning in c.execute(
        "SELECT reconstruction_id, variety_id, meaning FROM evolex_reflex WHERE meaning IS NOT NULL"
    ):
        for s in set(senses(meaning)):
            per_root[rid][s] += 1
            varieties[(rid, s)].add(vid)
    rows = [
        (rid, s, n, len(varieties[(rid, s)]))
        for rid, counter in per_root.items()
        for s, n in counter.items()
    ]
    c.executemany(
        "INSERT INTO evolex_sense (reconstruction_id, sense, reflexes, varieties) VALUES (?, ?, ?, ?)",
        rows,
    )

    pairs: Counter = Counter()
    for counter in per_root.values():
        # Ties broken alphabetically, so rebuilds give the same pairs.
        top = sorted(sorted(counter, key=lambda s: (-counter[s], s))[:MAX_SENSES])
        pairs.update(combinations(top, 2))
    c.executemany(
        "INSERT INTO evolex_sense_pair VALUES (?, ?, ?)",
        [(a, b, w) for (a, b), w in pairs.items() if w >= 2],
    )

    c.executescript(LATE_INDEXES)
    c.commit()
    for table in ("evolex_etyma", "evolex_etyma_zone", "evolex_reflex", "evolex_variety",
                  "evolex_source", "evolex_sense", "evolex_sense_pair"):
        logger.info(f"  {table}: {c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]}")
    # The browser reads pages over HTTP range requests: 1 KiB pages (instead
    # of 4 KiB) mean less transferred per lookup, as sqlite-wasm-http recommends.
    c.execute("PRAGMA journal_mode = DELETE")
    c.execute("PRAGMA page_size = 1024")
    c.execute("VACUUM")
    c.close()


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DB
    logger.info(f"EvoLex tables in {path}")
    build(path)
