import os
import sqlite3
from pathlib import Path
from sqlalchemy import create_engine, event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session

DB_PATH = Path(os.environ.get("DATABASE_PATH", "/data/bantulex.db"))

engine = create_engine(
    "sqlite://",
    creator=lambda: sqlite3.connect(
        f"file:{DB_PATH}?immutable=1", uri=True
    ),
    poolclass=StaticPool,  # één gedeelde connectie, geen thread-issues
)

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON;")
    cursor.execute("PRAGMA query_only=ON;")
    cursor.close()

def get_session():
    with Session(engine) as session:
        yield session
