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
    """Variety of Bantu"""
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
    """Coordinate of Bantu"""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    description: Optional[str] = None # 'default', 'original'
    
    location_id: Optional[int] = Field(default=None, foreign_key="location.id")
    location: Optional["Location"] = Relationship(back_populates="coordinates")

class Country(Table, table=True):
    """Country of Bantu"""
    name: Optional[str] = None
    
class Region(Table, table=True):
    """Region of Bantu"""
    name: Optional[str] = None
    country_id: Optional[int] = Field(default=None, foreign_key="country.id")
    country: Optional["Country"] = Relationship(back_populates="regions")

class Place(Table, table=True):
    """Place of Bantu"""
    name: Optional[str] = None
    region_id: Optional[int] = Field(default=None, foreign_key="region.id")
    region: Optional["Region"] = Relationship(back_populates="places")

class Location(Table, table=True):
    """Location of Bantu"""
    place: Optional[Place] = Relationship()
    region: Optional[Region] = None
    country: Optional[Country] = None
    clan: Optional[str] = None
    coordinates: List[Coordinate] = Relationship(back_populates="location")

    place_id: Optional[int] = Field(default=None, foreign_key="place.id")
    region_id: Optional[int] = Field(default=None, foreign_key="region.id")
    country_id: Optional[int] = Field(default=None, foreign_key="country.id")

    entries: List["Entry"] = Relationship(back_populates="location")

class Source(Table, table=True):
    """Source of Bantu"""
    author_year: Optional[str] = None
    title: Optional[str] = None
    pages: Optional[str] = None
    # No back_populates to avoid conflicts with multiple FKs on Entry

class Fieldwork(Table, table=True):
    """Fieldwork of Bantu"""
    project: Optional[str] = None
    year: Optional[str] = None
    consultants: Optional[str] = None # JSON or comma-separated
    data_collectors: Optional[str] = None
    archive: Optional[str] = None
    data_entered_by: Optional[str] = None

    entries: List["Entry"] = Relationship(back_populates="fieldwork")

class SourceEntries(Table, table=True):
    """Link table between Entry and Source, acting as a Citation with a role."""
    role: str = Field(index=True) # primary, second, cited, second_cited
    
    entry_id: Optional[int] = Field(default=None, foreign_key="entry.id")
    source_id: Optional[int] = Field(default=None, foreign_key="source.id")
    
    entry: "Entry" = Relationship(back_populates="sources")
    source: "Source" = Relationship()

class Entry(Table, table=True):
    """Entry of Bantu"""
    original_id: Optional[int] = None
    beginning_id: Optional[int] = None
    
    term: Optional[str] = None
    term_morph_analysis: Optional[str] = None
    translation: Optional[str] = None
    meaning: Optional[str] = None
    scientific_name: Optional[str] = None
    semantic_field: Optional[str] = None
    part_of_speech: Optional[str] = None
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