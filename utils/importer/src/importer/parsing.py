import re
from itertools import islice
from typing import Any


def clean_value(val: Any) -> str | None:
    if val is None or val == "" or str(val).lower() == "nan":
        return None
    s = str(val).strip()
    return s if s else None


def parse_float(val: Any) -> float | None:
    try:
        return float(val) if val is not None else None
    except (ValueError, TypeError):
        return None


def parse_int(val: Any) -> int | None:
    try:
        return int(val) if val is not None else None
    except (ValueError, TypeError):
        return None


def parse_uncertainty(val: Any) -> tuple[str | None, bool]:
    """
    Strip uncertainty markers; return (cleaned_value, is_uncertain).

    Examples:
        "?????" or "???"             -> (None, True)
        "Bouka 1989?"                -> ("Bouka 1989", True)
        "Crine 1981 (?)"             -> ("Crine 1981", True)
        "Daeleman 1975 (or 1976?)"   -> ("Daeleman 1975 (or 1976)", True)
    Alternative year is preserved to avoid data loss.
    These entries are flagged in the report for manual review.
    """
    if not val:
        return None, False
    s = str(val).strip()
    if re.fullmatch(r"\?+", s):
        return None, True
    if "?" not in s:
        return s, False
    cleaned = re.sub(r"\s*\(\?\)\s*", " ", s).strip()
    cleaned = re.sub(r"\?", "", cleaned).strip()
    return cleaned, True


def normalize_key(key: tuple) -> tuple:
    """Case- and whitespace-insensitive version of a cache key for near-duplicate detection."""
    return tuple(v.casefold().strip() if isinstance(v, str) else v for v in key)


def chunked(iterable, n: int):
    it = iter(iterable)
    while True:
        chunk = list(islice(it, n))
        if not chunk:
            return
        yield chunk
