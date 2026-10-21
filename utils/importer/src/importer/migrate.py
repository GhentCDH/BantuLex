"""Bring an existing database up to the current model without re-importing.

A re-import rebuilds data/bantulex.db from the spreadsheets and loses edits
made in the admin. This adds what model.py has and the database lacks:
missing tables (with their updated_at triggers) and missing nullable columns
(with their foreign keys) and missing indexes. Running it again changes nothing.

It also moves reflex.blr_index into reflex.reconstruction_note (the former
blr_note) and drops it: the BLR number of a reflex is read via blr_entry_id.

Gebruik:
  uv run migrate-db
"""

import logging

from rich.logging import RichHandler
from sqlalchemy import inspect
from sqlalchemy.schema import CreateIndex
from sqlmodel import SQLModel

import utilities.model  # noqa: F401  (registers the tables)
from utilities.config import DB_PATH
from utilities.db import create_all, engine

from .parsing import append_note

handler = RichHandler(markup=True, show_time=True, show_path=False)
logging.basicConfig(level=logging.INFO, format="%(message)s", handlers=[handler])
logger = logging.getLogger(__name__)


def drop_reflex_blr_index(conn) -> None:
    """Keep every reflex.blr_index that is not its link's index in the note, then drop the column."""
    columns = {row[1] for row in conn.exec_driver_sql('PRAGMA table_info("reflex")')}
    if "blr_note" in columns and "reconstruction_note" not in columns:
        conn.exec_driver_sql('ALTER TABLE reflex RENAME COLUMN blr_note TO reconstruction_note')
        logger.info("  renamed column reflex.blr_note to reconstruction_note")
    if "blr_index" not in columns:
        return
    rows = conn.exec_driver_sql(
        """SELECT x.id, x.blr_index, x.reconstruction_note FROM reflex x
           LEFT JOIN reconstruction r ON r.id = x.blr_entry_id
           WHERE TRIM(COALESCE(x.blr_index, '')) <> ''
             AND (r.id IS NULL OR CAST(r.blr_index AS TEXT) <> TRIM(x.blr_index))"""
    ).all()
    for reflex_id, blr_index, note in rows:
        conn.exec_driver_sql(
            "UPDATE reflex SET reconstruction_note = ? WHERE id = ?",
            (append_note(note, blr_index), reflex_id),
        )
    logger.info(f"  kept {len(rows)} unlinked reflex.blr_index values in reconstruction_note")
    conn.exec_driver_sql('ALTER TABLE reflex DROP COLUMN blr_index')
    logger.info("  dropped column reflex.blr_index")


def main() -> None:
    logger.info(f"Migrating {DB_PATH}")
    if "reflex" in inspect(engine).get_table_names():
        with engine.begin() as conn:
            drop_reflex_blr_index(conn)
    before = set(inspect(engine).get_table_names())
    # New tables, and their triggers (after_create in model.py).
    create_all(engine)
    for name in sorted(set(inspect(engine).get_table_names()) - before):
        logger.info(f"  created table {name}")

    dialect = engine.dialect
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if table.name not in before:
                continue
            existing = {row[1] for row in conn.exec_driver_sql(f'PRAGMA table_info("{table.name}")')}
            for column in table.columns:
                if column.name in existing:
                    continue
                if not column.nullable or column.primary_key:
                    raise SystemExit(f"Cannot add NOT NULL column {table.name}.{column.name}; rebuild instead.")
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {column.type.compile(dialect)}'
                for fk in column.foreign_keys:
                    ddl += f' REFERENCES "{fk.column.table.name}"("{fk.column.name}")'
                conn.exec_driver_sql(ddl)
                logger.info(f"  added column {table.name}.{column.name}")
        # Indexes added to existing columns (e.g. sourceentries.entry_id).
        indexes = {row[0] for row in conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type = 'index'")}
        for table in SQLModel.metadata.sorted_tables:
            for index in table.indexes:
                if index.name not in indexes:
                    conn.execute(CreateIndex(index, if_not_exists=True))
                    logger.info(f"  created index {index.name}")
        cleared = conn.exec_driver_sql(
            "UPDATE reflex SET reconstruction_note = NULLIF(TRIM(reconstruction_note), '') "
            "WHERE reconstruction_note IS NOT NULL AND reconstruction_note <> TRIM(reconstruction_note) "
            "OR TRIM(reconstruction_note) = ''"
        ).rowcount
        if cleared:
            logger.info(f"  trimmed {cleared} reflex.reconstruction_note values (blank ones to NULL)")
    logger.info("Migration done.")
