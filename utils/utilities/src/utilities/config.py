import os
from pathlib import Path

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent.parent.parent

# load environment variables for development
# in production (docker), env variables are loaded by Docker (.env)
load_dotenv(env_path / "utils.env")

print(f"Loading environment variables from: {env_path / 'utils.env'}")
print(f"DATABASE_URL: {'\u2219' * len(os.getenv('DATABASE_URL') or '')}")
print(f"DATA_ROOT: {os.getenv('DATA_ROOT')}")

required_env_vars = ["DATABASE_URL", "DATA_ROOT"]
for var in required_env_vars:
    if var not in os.environ:
        raise OSError(f"Required environment variable '{var}' is not set.")

DB_STRING = os.environ["DATABASE_URL"]

DATA_ROOT = Path(os.getenv("DATA_ROOT") or exit(1))

CSV = DATA_ROOT / "bantulex.csv"
EXCEL = DATA_ROOT / "bantulex.xlsx"
BLR_EXCEL = DATA_ROOT / "BLR.xlsx"

EXPORT_EVOLEX_EXCEL = DATA_ROOT / "evolex_export.xlsx"
EXPORT_BLR_JSON = DATA_ROOT / "blr_catalog.json"
EXPORT_GEOJSON = DATA_ROOT / "bantulex_entries.geojson"
