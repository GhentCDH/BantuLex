from collections.abc import Callable
from typing import Any

import sqlmodel

from .config import DB_STRING

engine = sqlmodel.create_engine(
    DB_STRING,
    connect_args={"options": "-c synchronous_commit=off"},
)


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
