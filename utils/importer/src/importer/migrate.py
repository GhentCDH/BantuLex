"""Bring an existing database up to the current model without re-importing.

A re-import rebuilds data/bantulex.db from the spreadsheets and loses edits
made in the admin. This adds what model.py has and the database lacks:
missing tables (with their updated_at triggers) and missing nullable columns
(with their foreign keys) and missing indexes. Running it again changes nothing.

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
from utilities.db import engine

handler = RichHandler(markup=True, show_time=True, show_path=False)
logging.basicConfig(level=logging.INFO, format="%(message)s", handlers=[handler])
logger = logging.getLogger(__name__)


def main() -> None:
    logger.info(f"Migrating {DB_PATH}")
    before = set(inspect(engine).get_table_names())
    # New tables, and their triggers (after_create in model.py).
    SQLModel.metadata.create_all(engine)
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
    logger.info("Migration done.")
