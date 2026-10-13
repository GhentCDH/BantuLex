from collections.abc import Callable
from typing import Any

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
    cursor.execute("PRAGMA foreign_keys = ON")
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
