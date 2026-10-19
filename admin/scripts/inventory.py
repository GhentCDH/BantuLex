"""Write tests/inventory.json (tables, columns, foreign keys) from the SQLite database.

Run after the database schema changes:
  docker compose run --rm --no-deps utils python3 /app/admin/scripts/inventory.py
"""
import json
import os
import pathlib
import sqlite3

root = pathlib.Path(__file__).resolve().parents[1]
db = pathlib.Path(os.getenv("DATABASE_PATH") or root.parent / "data" / "bantulex.db")
c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
inventory = []
for (table,) in c.execute(
    "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name"
):
    cols = c.execute(f'pragma table_info("{table}")').fetchall()
    fks = {x[3]: x[2] for x in c.execute(f'pragma foreign_key_list("{table}")')}
    inventory.append(
        {
            "table": table,
            "columns": [
                {"name": x[1], "type": x[2], "required": bool(x[3]), "pk": x[5]}
                for x in cols
            ],
            "foreignKeys": fks,
        }
    )
(root / "tests" / "inventory.json").write_text(json.dumps(inventory, indent=2) + "\n")
print(f"{len(inventory)} tables, {sum(len(t['columns']) for t in inventory)} columns")
