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

class Location(Table, table=True):
    """Location of Bantu"""
    place: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    clan: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    longitude_source: Optional[str] = None
    latitude_source: Optional[str] = None

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
    
    source_id: Optional[int] = Field(default=None, foreign_key="source.id")
    second_source_id: Optional[int] = Field(default=None, foreign_key="source.id")
    cited_source_id: Optional[int] = Field(default=None, foreign_key="source.id")
    second_cited_source_id: Optional[int] = Field(default=None, foreign_key="source.id")

    # Relationships
    variety: Optional[Variety] = Relationship(back_populates="entries")
    location: Optional[Location] = Relationship(back_populates="entries")
    fieldwork: Optional[Fieldwork] = Relationship(back_populates="entries")
    
    # Source relationships
    source: Optional[Source] = Relationship(sa_relationship_kwargs={"primaryjoin": "Entry.source_id==Source.id"})
    second_source: Optional[Source] = Relationship(sa_relationship_kwargs={"primaryjoin": "Entry.second_source_id==Source.id"})
    cited_source: Optional[Source] = Relationship(sa_relationship_kwargs={"primaryjoin": "Entry.cited_source_id==Source.id"})
    second_cited_source: Optional[Source] = Relationship(sa_relationship_kwargs={"primaryjoin": "Entry.second_cited_source_id==Source.id"})
