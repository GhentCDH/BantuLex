import re
from itertools import islice
from typing import Any


def clean_value(val: Any) -> str | None:
    if val is None or val == "" or str(val).lower() == "nan":
        return None
    s = str(val).strip()
    return s if s else None


def append_note(existing: str | None, text: str | None) -> str | None:
    """Append `text` to a note with "; "; whitespace-only becomes None, a text already in the note is not repeated."""
    existing = (existing or "").strip()
    text = (text or "").strip()
    if not text or text in existing:
        return existing or None
    return f"{existing}; {text}" if existing else text


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


# "9094 ipv 3604": 9094 replaces ("in plaats van") 3604, so the first number is the index.
_BLR_IPV = re.compile(r"^\s*(\d+)\s+ipv\b", re.IGNORECASE)


def parse_blr_index(val: str | None) -> tuple[str | None, str | None, bool]:
    """
    Split a raw 'BLR Index' cell into (index, note, used_ipv).

    Examples:
        "3132"            -> ("3132", None, False)
        "9094 ipv 3604"   -> ("9094", "9094 ipv 3604", True)
        "7364 (PT??)"     -> (None, "7364 (PT??)", False)
    Only plain integers and 'X ipv Y' get an index (and are linked to BLR);
    any other text is kept as a note so nothing unchecked gets linked.
    """
    if val is None:
        return None, None, False
    if val.isdigit():
        return val, None, False
    m = _BLR_IPV.match(val)
    if m:
        return m.group(1), val, True
    return None, val, False


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
