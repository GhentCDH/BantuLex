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


def check_case_variant(
    norm_map: dict[tuple, tuple],
    key: tuple,
    entity: str,
    excel_row: int,
    report: "ImportReport",  # noqa: F821
    extra: dict[str, Any] | None = None,
) -> None:
    """Log a case_variant warning when the same key exists with different capitalisation."""
    norm = normalize_key(key)
    if norm in norm_map and norm_map[norm] != key:
        entry: dict[str, Any] = {
            "Row": excel_row,
            "Entity": entity,
            "New Value": " | ".join(str(v) for v in key if v is not None),
            "Existing Value": " | ".join(
                str(v) for v in norm_map[norm] if v is not None
            ),
            "Note": "Zelfde waarden, ander hoofdlettergebruik — mogelijke duplicaat.",
        }
        if extra:
            entry.update(extra)
        report.add("case_variant", entry)
    else:
        norm_map.setdefault(norm, key)


def parse_id_with_report(
    raw: Any,
    column: str,
    excel_row: int,
    report: "ImportReport",  # noqa: F821
) -> int | None:
    """parse_int + log invalid_format when raw is present but unparseable."""
    val = parse_int(raw)
    if raw is not None and val is None:
        report.add(
            "invalid_format",
            {
                "Row": excel_row,
                "Column": column,
                "Original Value": raw,
                "Note": "Kon niet worden geparsed als int; opgeslagen als NULL.",
            },
        )
    return val


def chunked(iterable, n: int):
    it = iter(iterable)
    while True:
        chunk = list(islice(it, n))
        if not chunk:
            return
        yield chunk
