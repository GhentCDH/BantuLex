import re

EXPECTED_COLUMNS = [
    "Variety (English)",
    "variety (French)",
    "Variety (Bantu)",
    "Variety as named in Bastin",
    "Branch",
    "Bastin Index",
    "Guthrie Index",
    "Guthrie PLUS",
    "Country",
    "Region (fieldwork)",
    "Place",
    "Latitude",
    "Longitude",
    "Latitude OR source",
    "Longitude OR source",
    "Project",
    "Year of collection",
    "Data collector 1",
    "Data collector 2",
    "Consultant 1",
    "Consultant 2",
    "Consultant 3",
    "Consultant 4",
    "Archive",
    "Data entered by",
    "Source (Author YEAR)",
    "Title",
    "Page number",
    "Second source (Author Year)",
    "Title second source",
    "Page number second source",
    "Cited source",
    "Title cited source",
    "Pages cited source",
    "Second cited source",
    "Title second cited source",
    "Pages second cited source",
    "ID 20250825",
    "ID beginning",
    "Term",
    "Term with Morphological Analysis",
    "Translation",
    "Meaning",
    "Scientific name",
    "Semantic field",
    "Part of Speech",
    "BLR Index",
    "IPA",
    "Opmerking",
    "Notes",
]

# Field names for dynamic grouping
COLLECTOR_PATTERN = re.compile(r"Data collector \d+")
CONSULTANT_PATTERN = re.compile(r"Consultant \d+")

# Source groups (Author/Year, Title, Page, Role)
# Unified role system: everyone is 'primary' or 'cited', 'order' handles slots.
SOURCE_GROUPS = [
    ("Source (Author YEAR)", "Title", "Page number", "primary"),
    (
        "Second source (Author Year)",
        "Title second source",
        "Page number second source",
        "primary",
    ),
    ("Source Fieldwork (data collector YEAR)", None, None, "primary"),
    ("Cited source", "Title cited source", "Pages cited source", "cited"),
    (
        "Second cited source",
        "Title second cited source",
        "Pages second cited source",
        "cited",
    ),
]

# Fields to check for leading/trailing whitespace before clean_value strips them
WHITESPACE_CHECK_FIELDS = [
    "Variety (English)",
    "variety (French)",
    "Variety (Bantu)",
    "Country",
    "Region (fieldwork)",
    "Place",
    "Source (Author YEAR)",
    "Second source (Author Year)",
    "Data collector 1",
    "Data collector 2",
    "Term",
]
