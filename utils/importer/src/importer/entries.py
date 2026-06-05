"""Typed report entries with source-location tracing.

Every importer issue is recorded as a frozen dataclass carrying a
``SourceLocation`` (file, sheet, row, column, cell reference) plus a
human-readable Dutch note, instead of an ad-hoc ``dict[str, Any]``.
"""

from dataclasses import dataclass, fields
from functools import lru_cache
from typing import TYPE_CHECKING, Any, ClassVar

from openpyxl.utils import get_column_letter

from .parsing import clean_value, normalize_key, parse_float, parse_int

if TYPE_CHECKING:
    from .report import ImportReport


# ---------------------------------------------------------------------------
# Location
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SourceLocation:
    """Where in the source data a problem was found."""

    file: str  # e.g. "bantulex.xlsx"
    sheet: str  # worksheet title
    row: int | None  # 1-based Excel row; None for header/DB-level issues
    column: str | None  # header name, e.g. "Latitude"
    cell: str | None  # Excel cell reference, e.g. "BK1234"


def build_col_index(headers: list[str | None]) -> dict[str, int]:
    """Map header name -> 0-based column position (built once per sheet)."""
    return {h: i for i, h in enumerate(headers) if h is not None}


@dataclass(slots=True)
class RowContext:
    """Per-row context: builds traced locations and reporting parse helpers."""

    file: str
    sheet: str
    row: int
    col_index: dict[str, int]
    report: "ImportReport"
    data: dict[str, Any]

    def loc(self, column: str | None = None) -> SourceLocation:
        """SourceLocation for a column in this row, with Excel cell reference."""
        idx = self.col_index.get(column) if column is not None else None
        cell = (
            f"{get_column_letter(idx + 1)}{self.row}" if idx is not None else None
        )
        return SourceLocation(self.file, self.sheet, self.row, column, cell)

    def _report_nan(self, column: str, raw: Any) -> None:
        if raw is not None and str(raw).strip().lower() == "nan":
            self.report.add(
                NanCoercionEntry(
                    loc=self.loc(column),
                    note="Waarde 'nan' geïnterpreteerd als leeg (NULL).",
                    original_value=raw,
                )
            )

    def val(self, column: str) -> str | None:
        """clean_value of the cell + report silent 'nan' coercion."""
        raw = self.data.get(column)
        val = clean_value(raw)
        if val is None:
            self._report_nan(column, raw)
        return val

    def float(self, column: str) -> float | None:
        """parse_float of the cell + report unparseable values and 'nan' coercion."""
        raw = self.data.get(column)
        cleaned = clean_value(raw)
        if cleaned is None:
            self._report_nan(column, raw)
            return None
        val = parse_float(cleaned)
        if val is None:
            self.report.add(
                InvalidFormatEntry(
                    loc=self.loc(column),
                    note="Kon niet worden geparsed als kommagetal; opgeslagen als NULL.",
                    original_value=raw,
                    expected_type="float",
                )
            )
        return val

    def int(self, column: str) -> int | None:
        """parse_int of the cell + report unparseable values and 'nan' coercion."""
        raw = self.data.get(column)
        cleaned = clean_value(raw)
        if cleaned is None:
            self._report_nan(column, raw)
            return None
        val = parse_int(cleaned)
        if val is None:
            self.report.add(
                InvalidFormatEntry(
                    loc=self.loc(column),
                    note="Kon niet worden geparsed als int; opgeslagen als NULL.",
                    original_value=raw,
                    expected_type="int",
                )
            )
        return val


def check_case_variant(
    norm_map: dict[tuple, tuple],
    key: tuple,
    entity: str,
    ctx: RowContext,
    column: str | None = None,
    term: str | None = None,
) -> None:
    """Log a case_variant warning when the same key exists with different capitalisation."""
    norm = normalize_key(key)
    if norm in norm_map and norm_map[norm] != key:
        ctx.report.add(
            CaseVariantEntry(
                loc=ctx.loc(column),
                note="Zelfde waarden, ander hoofdlettergebruik — mogelijke duplicaat.",
                entity=entity,
                new_value=" | ".join(str(v) for v in key if v is not None),
                existing_value=" | ".join(
                    str(v) for v in norm_map[norm] if v is not None
                ),
                term=term,
            )
        )
    else:
        norm_map.setdefault(norm, key)


# ---------------------------------------------------------------------------
# Entry dataclasses (one per report category)
# ---------------------------------------------------------------------------


# Severity levels: how serious is the reported issue?
LEVEL_NOTE = "note"  # harmless, automatically handled (e.g. whitespace stripped)
LEVEL_WARNING = "warning"  # suspicious, needs human review
LEVEL_ERROR = "error"  # data was lost or a row was dropped

LEVEL_ORDER: dict[str, int] = {LEVEL_ERROR: 0, LEVEL_WARNING: 1, LEVEL_NOTE: 2}


@dataclass(frozen=True, slots=True)
class ReportEntry:
    """Base for all report entries: a traced location + Dutch explanation."""

    loc: SourceLocation
    note: str

    category: ClassVar[str] = ""
    level: ClassVar[str] = LEVEL_WARNING


@dataclass(frozen=True, slots=True)
class UncertaintyEntry(ReportEntry):
    original_value: Any = None
    cleaned_value: str | None = None
    status: str | None = None

    category: ClassVar[str] = "uncertainty"
    level: ClassVar[str] = LEVEL_WARNING


@dataclass(frozen=True, slots=True)
class FallbackUsedEntry(ReportEntry):
    lat_used: float | None = None
    lon_used: float | None = None

    category: ClassVar[str] = "fallback_used"
    level: ClassVar[str] = LEVEL_NOTE


@dataclass(frozen=True, slots=True)
class CoordinateConflictEntry(ReportEntry):
    coord_type: str = ""
    existing_lat: float | None = None
    existing_lon: float | None = None
    new_lat: float | None = None
    new_lon: float | None = None
    term: str | None = None
    variety_english: str | None = None
    country: str | None = None
    place: str | None = None
    conflicting_row: int | None = None

    category: ClassVar[str] = "coordinate_conflict"
    level: ClassVar[str] = LEVEL_WARNING


@dataclass(frozen=True, slots=True)
class InvalidFormatEntry(ReportEntry):
    original_value: Any = None
    cleaned_value: Any = None
    expected_type: str = ""

    category: ClassVar[str] = "invalid_format"
    level: ClassVar[str] = LEVEL_ERROR


@dataclass(frozen=True, slots=True)
class NanCoercionEntry(ReportEntry):
    """A literal 'nan' cell value was silently interpreted as empty."""

    original_value: Any = None

    category: ClassVar[str] = "nan_coercion"
    level: ClassVar[str] = LEVEL_NOTE


@dataclass(frozen=True, slots=True)
class DuplicateBeginningIdEntry(ReportEntry):
    beginning_id: int | None = None
    first_seen_row: int | None = None
    term: str | None = None
    variety_english: str | None = None

    category: ClassVar[str] = "duplicate_beginning_id"
    level: ClassVar[str] = LEVEL_ERROR


@dataclass(frozen=True, slots=True)
class CaseVariantEntry(ReportEntry):
    entity: str = ""
    new_value: str = ""
    existing_value: str = ""
    term: str | None = None

    category: ClassVar[str] = "case_variant"
    level: ClassVar[str] = LEVEL_WARNING


@dataclass(frozen=True, slots=True)
class WhitespaceVariantEntry(ReportEntry):
    raw_value: str = ""
    stripped_value: str = ""

    category: ClassVar[str] = "whitespace_variant"
    level: ClassVar[str] = LEVEL_NOTE


@dataclass(frozen=True, slots=True)
class MissingColumnEntry(ReportEntry):
    # loc.row/cell are None; loc.column holds the missing header name.
    category: ClassVar[str] = "missing_column"
    level: ClassVar[str] = LEVEL_ERROR


@dataclass(frozen=True, slots=True)
class SuspiciousDuplicateEntry(ReportEntry):
    first_seen_row: int | None = None
    term: str | None = None
    variety_english: str | None = None
    guthrie_index: str | None = None

    category: ClassVar[str] = "suspicious_duplicate"
    level: ClassVar[str] = LEVEL_WARNING


@dataclass(frozen=True, slots=True)
class SourceIncompleteEntry(ReportEntry):
    author_year_column: str = ""
    author_year_value: str = ""
    title_column: str | None = None
    title_value: str = ""

    category: ClassVar[str] = "source_incomplete"
    level: ClassVar[str] = LEVEL_WARNING


@dataclass(frozen=True, slots=True)
class SkippedNoTermEntry(ReportEntry):
    variety_english: str | None = None
    guthrie_index: str | None = None
    country: str | None = None

    category: ClassVar[str] = "skipped_no_term"
    level: ClassVar[str] = LEVEL_ERROR


@dataclass(frozen=True, slots=True)
class BlrUnresolvedLinkEntry(ReportEntry):
    reflex_id: int | None = None
    blr_index_raw: Any = None

    category: ClassVar[str] = "blr_unresolved_link"
    level: ClassVar[str] = LEVEL_ERROR


@dataclass(frozen=True, slots=True)
class CriticalErrorEntry(ReportEntry):
    error_message: str = ""

    category: ClassVar[str] = "critical_error"
    level: ClassVar[str] = LEVEL_ERROR


# ---------------------------------------------------------------------------
# Serialization metadata
# ---------------------------------------------------------------------------

# Registry ordered errors first, then warnings, then notes.
CATEGORY_CLASSES: dict[str, type[ReportEntry]] = {
    cls.category: cls
    for cls in sorted(
        (
            UncertaintyEntry,
            FallbackUsedEntry,
            CoordinateConflictEntry,
            InvalidFormatEntry,
            NanCoercionEntry,
            DuplicateBeginningIdEntry,
            CaseVariantEntry,
            WhitespaceVariantEntry,
            MissingColumnEntry,
            SuspiciousDuplicateEntry,
            SourceIncompleteEntry,
            SkippedNoTermEntry,
            BlrUnresolvedLinkEntry,
            CriticalErrorEntry,
        ),
        key=lambda c: LEVEL_ORDER[c.level],
    )
}

# Location columns lead every sheet, in this order.
LOCATION_HEADERS: list[tuple[str, str]] = [
    ("sheet", "Sheet"),
    ("row", "Row"),
    ("cell", "Cell"),
    ("column", "Column"),
    ("file", "File"),
]

# Dataclass field name -> human-readable Excel column header.
FIELD_HEADERS: dict[str, str] = {
    "original_value": "Original Value",
    "cleaned_value": "Cleaned Value",
    "expected_type": "Expected Type",
    "status": "Status",
    "lat_used": "Lat used",
    "lon_used": "Lon used",
    "coord_type": "Type",
    "existing_lat": "Existing Lat",
    "existing_lon": "Existing Lon",
    "new_lat": "New Lat",
    "new_lon": "New Lon",
    "term": "Term",
    "variety_english": "Variety (English)",
    "country": "Country",
    "place": "Place",
    "conflicting_row": "Conflicting Row",
    "beginning_id": "beginning_id",
    "first_seen_row": "First seen at Row",
    "entity": "Entity",
    "new_value": "New Value",
    "existing_value": "Existing Value",
    "raw_value": "Raw Value",
    "stripped_value": "Stripped Value",
    "guthrie_index": "Guthrie Index",
    "author_year_column": "Author/Year Column",
    "author_year_value": "Author/Year Value",
    "title_column": "Title Column",
    "title_value": "Title Value",
    "reflex_id": "Reflex ID",
    "blr_index_raw": "BLR Index (raw)",
    "error_message": "Error Message",
    "note": "Note",
}


@lru_cache(maxsize=None)
def entry_fields(cls: type[ReportEntry]) -> tuple[str, ...]:
    """Category-specific field names in declaration order (excluding loc/note)."""
    return tuple(f.name for f in fields(cls) if f.name not in ("loc", "note"))
