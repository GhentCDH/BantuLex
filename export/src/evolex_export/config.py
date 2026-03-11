import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent.parent.parent

# load environment variables for development
# in production (docker), env variables are loaded by Docker (.env)
load_dotenv(ROOT / "dev.env")

DB_PATH = os.getenv("DB_PATH", str(ROOT / "data" / "bantulex.db"))
DB_STRING = f"sqlite:///{DB_PATH}"

CSV = ROOT / "data" / "bantulex.csv"
EXCEL = ROOT / "data" / "bantulex.xlsx"
EXPORT_EXCEL = ROOT / "data" / "evolex_export.xlsx"
