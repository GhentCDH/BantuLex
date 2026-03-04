from datetime import datetime
from typing import Optional, List

from sqlalchemy import Integer, Text, func
from sqlalchemy import REAL
from sqlmodel import Field, SQLModel, Relationship

_STRICT = {"sqlite_strict": True}


def _text(**kwargs):
    """TEXT column — VARCHAR is not STRICT-compatible."""
    return Field(sa_type=Text(), **kwargs)


def _real(**kwargs):
    """REAL column — FLOAT is not STRICT-compatible."""
    return Field(sa_type=REAL(), **kwargs)


class Table(SQLModel):
    """Base class with common fields for all tables."""
    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        default=None,
        sa_type=Text(),
        sa_column_kwargs={"server_default": func.now(), "nullable": False},
    )
    updated_at: datetime = Field(
        default=None,
        sa_type=Text(),
        sa_column_kwargs={"server_default": func.now(), "nullable": False},
    )


class BLREntry(Table, table=True):
    """
    A single BLR (Bantu Lexical Reconstructions) entry.
    blr_index is the numeric BLR identifier used to link with Entry.blr_index.
    """
    __table_args__ = _STRICT

    blr_index: Optional[int] = Field(default=None, index=True)  # "Index" column
    word_tone: Optional[str] = _text(default=None)    # "Word\Tone" — reconstructed form with tone
    word: Optional[str] = _text(default=None)          # "Word"      — without tone diacritics
    english: Optional[str] = _text(default=None)       # "English"
    french: Optional[str] = _text(default=None)        # "Français:"
    c1: Optional[str] = _text(default=None)
    c2: Optional[str] = _text(default=None)
    c3: Optional[str] = _text(default=None)
    c4: Optional[str] = _text(default=None)
    cs: Optional[str] = _text(default=None)            # consonant structure label
    noun_class: Optional[str] = _text(default=None)    # "N class"
    distribution: Optional[str] = _text(default=None)  # "Distr:" — Bantu zones
    reliability: Optional[str] = _text(default=None)   # "Fiab:"
    note: Optional[str] = _text(default=None)
    proto_kk: Optional[str] = _text(default=None)
    added_by: Optional[str] = _text(default=None)
    date_of_entry: Optional[str] = _text(default=None)
    # Tone slots
    t11: Optional[str] = _text(default=None)
    t12: Optional[str] = _text(default=None)
    t21: Optional[str] = _text(default=None)
    t22: Optional[str] = _text(default=None)
    t3: Optional[str] = _text(default=None)
    t4: Optional[str] = _text(default=None)
    # Vowel slots
    v11: Optional[str] = _text(default=None)
    v12: Optional[str] = _text(default=None)
    v21: Optional[str] = _text(default=None)
    v22: Optional[str] = _text(default=None)
    v3: Optional[str] = _text(default=None)
    v4: Optional[str] = _text(default=None)

    entries: List["Entry"] = Relationship(back_populates="blr_entry")


class Variety(Table, table=True):
    """A Bantu language variety."""
    __table_args__ = _STRICT

    name_english: Optional[str] = _text(default=None)
    name_french: Optional[str] = _text(default=None)
    name_bantu: Optional[str] = _text(default=None)
    name_bastin: Optional[str] = _text(default=None)
    branch: Optional[str] = _text(default=None)
    bastin_index: Optional[str] = _text(default=None)
    guthrie_index: Optional[str] = _text(default=None)
    guthrie_plus: Optional[str] = _text(default=None)
    # BOOLEAN is not STRICT-compatible; store as INTEGER (0/1)
    substrate_suspect: Optional[int] = Field(default=None, sa_type=Integer())

    entries: List["Entry"] = Relationship(back_populates="variety")


class Coordinate(Table, table=True):
    """Geographical coordinate attached to a location.

    description='default'  -> columns BK/BL (primary, possibly corrected)
    description='original' -> columns BM/BN (as found in original source)
    """
    __table_args__ = _STRICT

    # FLOAT is not STRICT-compatible; use REAL
    latitude: Optional[float] = _real(default=None)
    longitude: Optional[float] = _real(default=None)
    description: Optional[str] = _text(default=None)  # 'default' or 'original'

    location_id: Optional[int] = Field(default=None, foreign_key="location.id")
    location: Optional["Location"] = Relationship(back_populates="coordinates")


class Country(Table, table=True):
    """Country."""
    __table_args__ = _STRICT

    name: Optional[str] = _text(default=None)

    regions: List["Region"] = Relationship(back_populates="country")
    locations: List["Location"] = Relationship(back_populates="country")


class Region(Table, table=True):
    """Fieldwork region within a country."""
    __table_args__ = _STRICT

    name: Optional[str] = _text(default=None)
    country_id: Optional[int] = Field(default=None, foreign_key="country.id")

    country: Optional[Country] = Relationship(back_populates="regions")
    places: List["Place"] = Relationship(back_populates="region")
    locations: List["Location"] = Relationship(back_populates="region")


class Place(Table, table=True):
    """Specific place within a region."""
    __table_args__ = _STRICT

    name: Optional[str] = _text(default=None)
    region_id: Optional[int] = Field(default=None, foreign_key="region.id")

    region: Optional[Region] = Relationship(back_populates="places")
    locations: List["Location"] = Relationship(back_populates="place")


class Location(Table, table=True):
    """Composite location (place + region + country).
    Clan is intentionally excluded per project decision.
    """
    __table_args__ = _STRICT

    place_id: Optional[int] = Field(default=None, foreign_key="place.id")
    region_id: Optional[int] = Field(default=None, foreign_key="region.id")
    country_id: Optional[int] = Field(default=None, foreign_key="country.id")

    place: Optional[Place] = Relationship(back_populates="locations")
    region: Optional[Region] = Relationship(back_populates="locations")
    country: Optional[Country] = Relationship(back_populates="locations")

    coordinates: List[Coordinate] = Relationship(back_populates="location")
    entries: List["Entry"] = Relationship(back_populates="location")


class Source(Table, table=True):
    """Bibliographic source (author + year + title)."""
    __table_args__ = _STRICT

    author_year: Optional[str] = _text(default=None)
    # BOOLEAN is not STRICT-compatible; store as INTEGER (0/1)
    year_uncertain: int = Field(default=0, sa_type=Integer())
    title: Optional[str] = _text(default=None)


class Project(Table, table=True):
    """A research project."""
    __table_args__ = _STRICT

    name: Optional[str] = _text(default=None)

    fieldworks: List["Fieldwork"] = Relationship(back_populates="project")


class CollectionYear(Table, table=True):
    """
    A year of data collection with its certainty status.
    status: 'known' | 'uncertain' | 'unknown'
      known     -> normal year value
      uncertain -> year with ? marker (e.g. 'Bouka 1989?')
      unknown   -> was '?????' or unresolvable
    """
    __table_args__ = _STRICT

    value: Optional[str] = _text(default=None)  # actual year string; None when status='unknown'
    status: str = _text(default="known")

    fieldworks: List["Fieldwork"] = Relationship(back_populates="collection_year")


class DataCollector(Table, table=True):
    """A person who collected field data."""
    __table_args__ = _STRICT

    name: Optional[str] = _text(default=None)

    fieldwork_links: List["FieldworkDataCollector"] = Relationship(
        back_populates="data_collector"
    )


class FieldworkDataCollector(SQLModel, table=True):
    """Link table: Fieldwork <-> DataCollector. Composite PK, no auto-id."""
    __table_args__ = _STRICT

    fieldwork_id: int = Field(foreign_key="fieldwork.id", primary_key=True)
    data_collector_id: int = Field(foreign_key="datacollector.id", primary_key=True)

    fieldwork: "Fieldwork" = Relationship(back_populates="data_collector_links")
    data_collector: DataCollector = Relationship(back_populates="fieldwork_links")


class Fieldwork(Table, table=True):
    """A fieldwork session. Project, year and data collectors are normalised
    into their own tables."""
    __table_args__ = _STRICT

    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    collection_year_id: Optional[int] = Field(default=None, foreign_key="collectionyear.id")
    consultants: Optional[str] = _text(default=None)  # comma-separated (not yet normalised)
    archive: Optional[str] = _text(default=None)
    data_entered_by: Optional[str] = _text(default=None)

    project: Optional[Project] = Relationship(back_populates="fieldworks")
    collection_year: Optional[CollectionYear] = Relationship(back_populates="fieldworks")
    data_collector_links: List[FieldworkDataCollector] = Relationship(
        back_populates="fieldwork"
    )

    entries: List["Entry"] = Relationship(back_populates="fieldwork")


class SourceEntries(Table, table=True):
    """Link table between Entry and Source (citation with a role)."""
    __table_args__ = _STRICT

    role: str = _text(index=True)              # primary | second | cited | second_cited
    pages: Optional[str] = _text(default=None)  # page number as printed, per entry

    entry_id: Optional[int] = Field(default=None, foreign_key="entry.id")
    source_id: Optional[int] = Field(default=None, foreign_key="source.id")

    entry: "Entry" = Relationship(back_populates="sources")
    source: "Source" = Relationship()


class Entry(Table, table=True):
    """A single lexical entry."""
    __table_args__ = _STRICT

    # Original spreadsheet IDs
    original_id: Optional[int] = None
    # beginning_id is the primary business identifier and must be unique
    beginning_id: Optional[int] = Field(default=None, unique=True, index=True)

    term: Optional[str] = _text(default=None)
    term_morph_analysis: Optional[str] = _text(default=None)
    translation: Optional[str] = _text(default=None)
    meaning: Optional[str] = _text(default=None)
    scientific_name: Optional[str] = _text(default=None)
    semantic_field: Optional[str] = _text(default=None)
    part_of_speech: Optional[str] = _text(default=None)
    blr_index: Optional[str] = _text(default=None)  # raw string from BantuLex spreadsheet
    ipa: Optional[str] = _text(default=None)
    notes: Optional[str] = _text(default=None)

    # Foreign Keys
    variety_id: Optional[int] = Field(default=None, foreign_key="variety.id")
    location_id: Optional[int] = Field(default=None, foreign_key="location.id")
    fieldwork_id: Optional[int] = Field(default=None, foreign_key="fieldwork.id")
    blr_entry_id: Optional[int] = Field(default=None, foreign_key="blrentry.id", index=True)

    # Relationships
    variety: Optional[Variety] = Relationship(back_populates="entries")
    location: Optional[Location] = Relationship(back_populates="entries")
    fieldwork: Optional[Fieldwork] = Relationship(back_populates="entries")
    sources: List[SourceEntries] = Relationship(back_populates="entry")
    blr_entry: Optional[BLREntry] = Relationship(back_populates="entries")