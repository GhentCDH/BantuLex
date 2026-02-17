import sqlmodel

from .config import DB_STRING

from sqlalchemy import event

engine = sqlmodel.create_engine(DB_STRING)

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()

def create_updated_at_trigger(engine):
    """Create SQLite triggers to auto-update the updated_at column."""
    with engine.begin() as conn:
        for table_name, table in sqlmodel.SQLModel.metadata.tables.items():
            if "updated_at" in table.columns:
                conn.execute(
                    sqlmodel.text(f"""
                    CREATE TRIGGER IF NOT EXISTS update_{table_name}_modtime
                        AFTER UPDATE ON {table_name}
                        FOR EACH ROW
                    BEGIN
                        UPDATE {table_name}
                        SET updated_at = CURRENT_TIMESTAMP
                        WHERE id = NEW.id;
                    END;
                    """)
                )
