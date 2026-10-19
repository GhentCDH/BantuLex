import os
from pathlib import Path

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent.parent.parent

# load environment variables for development
# in production (docker), env variables are loaded by Docker (.env)
load_dotenv(env_path / "utils.env")

print(f"Loading environment variables from: {env_path / 'utils.env'}")
print(f"DB_PATH: {os.getenv('DB_PATH')}")
print(f"DATA_ROOT: {os.getenv('DATA_ROOT')}")

required_env_vars = ["DB_PATH", "DATA_ROOT"]
for var in required_env_vars:
    if var not in os.environ:
        raise OSError(f"Required environment variable '{var}' is not set.")

DB_PATH = Path(os.environ["DB_PATH"])
DB_STRING = f"sqlite:///{DB_PATH}"

DATA_ROOT = Path(os.getenv("DATA_ROOT") or exit(1))

CSV = DATA_ROOT / "bantulex.csv"
# EXCEL_FILE: optional file name in DATA_ROOT, e.g. a newly delivered version
EXCEL = DATA_ROOT / (os.getenv("EXCEL_FILE") or "bantulex.xlsx")
# BLR_FILE: optional BLR workbook name in DATA_ROOT, e.g. a newly delivered export
BLR_EXCEL = DATA_ROOT / (os.getenv("BLR_FILE") or "BLR_export.xlsx")

EXPORT_EVOLEX_EXCEL = DATA_ROOT / "evolex_export.xlsx"
