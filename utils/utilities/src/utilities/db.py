from typing import Any, Callable

import sqlmodel
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from .config import DB_STRING

engine = sqlmodel.create_engine(
    DB_STRING,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode = DELETE")
    cursor.execute("PRAGMA locking_mode = EXCLUSIVE")
    cursor.execute("PRAGMA busy_timeout = 5000")
    cursor.execute("PRAGMA synchronous = NORMAL")
    cursor.close()


def get_or_create(cache: dict, key: tuple, factory: Callable, session) -> Any:
    """Return cached ORM object for key, or create/persist/cache a new one.
    Returns None when all key components are None.
    """
    if all(k is None for k in key):
        return None
    if key in cache:
        return cache[key]
    obj = factory()
    session.add(obj)
    session.flush()
    cache[key] = obj
    return obj


def create_updated_at_trigger(engine):
    """Create SQLite triggers to auto-update the updated_at column."""
    with engine.begin() as conn:
        for table_name, table in sqlmodel.SQLModel.metadata.tables.items():
            if "updated_at" in table.columns:
                conn.execute(sqlmodel.text(f"""
                    CREATE TRIGGER IF NOT EXISTS update_{table_name}_modtime
                    AFTER UPDATE ON {table_name}
                    FOR EACH ROW
                    BEGIN
                        UPDATE {table_name}
                        SET updated_at = CURRENT_TIMESTAMP
                        WHERE id = NEW.id;
                    END
                """))
