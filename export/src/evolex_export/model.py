from datetime import datetime
from typing import Optional, List

from sqlalchemy import DateTime, func
from sqlmodel import Field, SQLModel, Relationship


class Table(SQLModel):
    """Base class with common fields for all tables."""
    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        default=None,
        sa_type=DateTime(),
        sa_column_kwargs={"server_default": func.now(), "nullable": False},
    )
    updated_at: datetime = Field(
        default=None,
        sa_type=DateTime(),
        sa_column_kwargs={"server_default": func.now(), "nullable": False},
    )


class Variety(Table, table=True):
    """A Bantu language variety."""
    name_english: Optional[str] = None
    name_french: Optional[str] = None
    name_bantu: Optional[str] = None
    name_bastin: Optional[str] = None
    branch: Optional[str] = None
    bastin_index: Optional[str] = None
    guthrie_index: Optional[str] = None
    guthrie_plus: Optional[str] = None
    substrate_suspect: Optional[bool] = None

    entries: List["Entry"] = Relationship(back_populates="variety")


class Coordinate(Table, table=True):
    """Geographical coordinate attached to a location.

    description='default'  -> columns BK/BL (primary, possibly corrected)
    description='original' -> columns BM/BN (as found in original source)
    """
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    description: Optional[str] = None  # 'default' or 'original'

    location_id: Optional[int] = Field(default=None, foreign_key="location.id")
    location: Optional["Location"] = Relationship(back_populates="coordinates")


class Country(Table, table=True):
    """Country."""
    name: Optional[str] = None

    regions: List["Region"] = Relationship(back_populates="country")
    locations: List["Location"] = Relationship(back_populates="country")


class Region(Table, table=True):
    """Fieldwork region within a country."""
    name: Optional[str] = None
    country_id: Optional[int] = Field(default=None, foreign_key="country.id")

    country: Optional[Country] = Relationship(back_populates="regions")
    places: List["Place"] = Relationship(back_populates="region")
    locations: List["Location"] = Relationship(back_populates="region")


class Place(Table, table=True):
    """Specific place within a region."""
    name: Optional[str] = None
    region_id: Optional[int] = Field(default=None, foreign_key="region.id")

    region: Optional[Region] = Relationship(back_populates="places")
    locations: List["Location"] = Relationship(back_populates="place")


class Location(Table, table=True):
    """Composite location (place + region + country).
    Clan is intentionally excluded per project decision.
    """
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
    author_year: Optional[str] = None
    year_uncertain: bool = Field(default=False)
    title: Optional[str] = None


class Project(Table, table=True):
    """A research project."""
    name: Optional[str] = None

    fieldworks: List["Fieldwork"] = Relationship(back_populates="project")


class CollectionYear(Table, table=True):
    """
    A year of data collection with its certainty status.
    status: 'known' | 'uncertain' | 'unknown'
      known    -> normal year value
      uncertain -> year with ? marker (e.g. 'Bouka 1989?')
      unknown  -> was '?????' or unresolvable
    """
    value: Optional[str] = None   # actual year string; None when status='unknown'
    status: str = Field(default="known")

    fieldworks: List["Fieldwork"] = Relationship(back_populates="collection_year")


class DataCollector(Table, table=True):
    """A person who collected field data."""
    name: Optional[str] = None

    fieldwork_links: List["FieldworkDataCollector"] = Relationship(
        back_populates="data_collector"
    )


class FieldworkDataCollector(SQLModel, table=True):
    """Link table: Fieldwork <-> DataCollector. Composite PK, no auto-id."""
    fieldwork_id: int = Field(foreign_key="fieldwork.id", primary_key=True)
    data_collector_id: int = Field(foreign_key="datacollector.id", primary_key=True)

    fieldwork: "Fieldwork" = Relationship(back_populates="data_collector_links")
    data_collector: DataCollector = Relationship(back_populates="fieldwork_links")


class Fieldwork(Table, table=True):
    """A fieldwork session. Project, year and data collectors are normalised
    into their own tables."""
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    collection_year_id: Optional[int] = Field(default=None, foreign_key="collectionyear.id")
    consultants: Optional[str] = None      # comma-separated (not yet normalised)
    archive: Optional[str] = None
    data_entered_by: Optional[str] = None

    project: Optional[Project] = Relationship(back_populates="fieldworks")
    collection_year: Optional[CollectionYear] = Relationship(back_populates="fieldworks")
    data_collector_links: List[FieldworkDataCollector] = Relationship(
        back_populates="fieldwork"
    )
    entries: List["Entry"] = Relationship(back_populates="fieldwork")


class SourceEntries(Table, table=True):
    """Link table between Entry and Source (citation with a role)."""
    role: str = Field(index=True)  # primary | second | cited | second_cited
    pages: Optional[str] = None # page number as printed, per entry

    entry_id: Optional[int] = Field(default=None, foreign_key="entry.id")
    source_id: Optional[int] = Field(default=None, foreign_key="source.id")

    entry: "Entry" = Relationship(back_populates="sources")
    source: "Source" = Relationship()


class Entry(Table, table=True):
    """A single lexical entry."""
    # Original spreadsheet IDs
    original_id: Optional[int] = None
    # ID beginning is the primary business identifier and must be unique
    beginning_id: Optional[int] = Field(default=None, unique=True, index=True)

    term: Optional[str] = None
    term_morph_analysis: Optional[str] = None
    translation: Optional[str] = None
    meaning: Optional[str] = None
    scientific_name: Optional[str] = None
    semantic_field: Optional[str] = None
    part_of_speech: Optional[str] = None
    blr_index: Optional[str] = None
    ipa: Optional[str] = None
    notes: Optional[str] = None

    # Foreign Keys
    variety_id: Optional[int] = Field(default=None, foreign_key="variety.id")
    location_id: Optional[int] = Field(default=None, foreign_key="location.id")
    fieldwork_id: Optional[int] = Field(default=None, foreign_key="fieldwork.id")

    # Relationships
    variety: Optional[Variety] = Relationship(back_populates="entries")
    location: Optional[Location] = Relationship(back_populates="entries")
    fieldwork: Optional[Fieldwork] = Relationship(back_populates="entries")
    sources: List[SourceEntries] = Relationship(back_populates="entry")