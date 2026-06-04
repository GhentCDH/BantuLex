from typing import Any, ClassVar


class ImportReport:
    CATEGORIES: ClassVar[list[str]] = [
        "uncertainty",
        "fallback_used",
        "coordinate_conflict",
        "invalid_format",
        "duplicate_beginning_id",
        "case_variant",  # same key, different capitalisation
        "whitespace_variant",  # raw value had leading/trailing whitespace
        "missing_column",  # expected column absent from header
        "suspicious_duplicate",  # same term + variety combination
        "source_incomplete",  # author_year without title or vice versa
        "skipped_no_term",  # row silently skipped due to missing term
        "blr_unresolved_link",  # BLR index in Reflex has no matching Reconstruction
        "critical_error",
    ]

    def __init__(self) -> None:
        self.categories: dict[str, list[dict[str, Any]]] = {
            c: [] for c in self.CATEGORIES
        }

    def add(self, category: str, data: dict[str, Any]) -> None:
        self.categories.setdefault(category, []).append(data)

    def summary(self) -> dict[str, int]:
        """Return a dict of category -> count for non-empty categories."""
        return {c: len(v) for c, v in self.categories.items() if v}

    def save(self, path: str) -> None:
        from openpyxl import Workbook

        wb = Workbook()
        if wb.active:
            wb.remove(wb.active)
        for category in self.CATEGORIES:
            entries = self.categories.get(category, [])
            ws = wb.create_sheet(title=category.upper()[:31])
            if not entries:
                ws.append(["(no entries)"])
                continue
            headers = list(entries[0].keys())
            ws.append(headers)
            for entry in sorted(entries, key=lambda x: x.get("Row", 0)):
                ws.append([entry.get(h, "") for h in headers])
        wb.save(path)
