from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, Integer, Text, func
from sqlmodel import Field, Relationship, SQLModel


def _text(**kwargs):
    """TEXT column (unbounded varchar in Postgres)."""
    return Field(sa_type=Text(), **kwargs)


def _float(**kwargs):
    """Double-precision float column."""
    return Field(sa_type=Float(), **kwargs)


def _ts(**kwargs):
    """Timezone-aware timestamp column."""
    return Field(sa_type=DateTime(timezone=True), **kwargs)


class Table(SQLModel):
    """Base class with common fields for all tables."""

    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = _ts(
        default=None,
        sa_column_kwargs={"server_default": func.now(), "nullable": False},
    )
    updated_at: datetime = _ts(
        default=None,
        sa_column_kwargs={
            "server_default": func.now(),
            "onupdate": func.now(),
            "nullable": False,
        },
    )


class Variety(Table, table=True):
    """A Bantu language variety."""

    name_english: str | None = _text(default=None)
    name_french: str | None = _text(default=None)
    name_bantu: str | None = _text(default=None)
    name_bastin: str | None = _text(default=None)
    branch: str | None = _text(default=None)
    bastin_index: str | None = _text(default=None)
    guthrie_index: str | None = _text(default=None)
    guthrie_plus: str | None = _text(default=None)
    substrate_suspect: bool | None = Field(default=None, sa_type=Boolean())

    entries: list["Reflex"] = Relationship(back_populates="variety")


class Coordinate(Table, table=True):
    """Geographical coordinate attached to a location.

    description='default' -> columns BK/BL (primary, possibly corrected)
    description='original' -> columns BM/BN (as found in original source)
    """

    latitude: float | None = _float(default=None)
    longitude: float | None = _float(default=None)
    description: str | None = _text(default=None)  # 'default' or 'original'

    location_id: int | None = Field(default=None, foreign_key="location.id")
    location: Optional["Location"] = Relationship(back_populates="coordinates")


class Country(Table, table=True):
    """Country."""

    name: str | None = _text(default=None)

    regions: list["Region"] = Relationship(back_populates="country")
    locations: list["Location"] = Relationship(back_populates="country")


class Region(Table, table=True):
    """Fieldwork region within a country."""

    name: str | None = _text(default=None)
    country_id: int | None = Field(default=None, foreign_key="country.id")

    country: Country | None = Relationship(back_populates="regions")
    places: list["Place"] = Relationship(back_populates="region")
    locations: list["Location"] = Relationship(back_populates="region")


class Place(Table, table=True):
    """Specific place within a region."""

    name: str | None = _text(default=None)
    region_id: int | None = Field(default=None, foreign_key="region.id")

    region: Region | None = Relationship(back_populates="places")
    locations: list["Location"] = Relationship(back_populates="place")


class Location(Table, table=True):
    """Composite location (place + region + country).
    Clan is intentionally excluded per project decision.
    """

    place_id: int | None = Field(default=None, foreign_key="place.id")
    region_id: int | None = Field(default=None, foreign_key="region.id")
    country_id: int | None = Field(default=None, foreign_key="country.id")

    place: Place | None = Relationship(back_populates="locations")
    region: Region | None = Relationship(back_populates="locations")
    country: Country | None = Relationship(back_populates="locations")

    coordinates: list[Coordinate] = Relationship(back_populates="location")
    entries: list["Reflex"] = Relationship(back_populates="location")


class Source(Table, table=True):
    """Bibliographic source (author + year + title)."""

    author_year: str | None = _text(default=None)
    year_uncertain: bool = Field(default=False, sa_type=Boolean())
    title: str | None = _text(default=None)


class Project(Table, table=True):
    """A research project."""

    name: str | None = _text(default=None)

    fieldworks: list["Fieldwork"] = Relationship(back_populates="project")


class CollectionYear(Table, table=True):
    """
    A year of data collection with its certainty status.
    status: 'known' | 'uncertain' | 'unknown'
    known     -> normal year value
    uncertain -> year with ? marker (e.g. 'Bouka 1989?')
    unknown   -> was '?????' or unresolvable
    """

    value: str | None = _text(
        default=None
    )  # actual year string; None when status='unknown'
    status: str = _text(default="known")

    fieldworks: list["Fieldwork"] = Relationship(back_populates="collection_year")


class DataCollector(Table, table=True):
    """A person who collected field data."""

    name: str | None = _text(default=None)

    fieldwork_links: list["FieldworkDataCollector"] = Relationship(
        back_populates="data_collector"
    )


class FieldworkDataCollector(SQLModel, table=True):
    """Link table: Fieldwork <-> DataCollector. Composite PK, no auto-id."""

    fieldwork_id: int = Field(foreign_key="fieldwork.id", primary_key=True)
    data_collector_id: int = Field(foreign_key="datacollector.id", primary_key=True)

    fieldwork: "Fieldwork" = Relationship(back_populates="data_collector_links")
    data_collector: DataCollector = Relationship(back_populates="fieldwork_links")


class Consultant(Table, table=True):
    """A person who provided linguistic data (consultant/informant)."""

    name: str | None = _text(default=None)

    fieldwork_links: list["FieldworkConsultant"] = Relationship(
        back_populates="consultant"
    )


class FieldworkConsultant(SQLModel, table=True):
    """Link table: Fieldwork <-> Consultant. Composite PK, no auto-id."""

    fieldwork_id: int = Field(foreign_key="fieldwork.id", primary_key=True)
    consultant_id: int = Field(foreign_key="consultant.id", primary_key=True)

    fieldwork: "Fieldwork" = Relationship(back_populates="consultant_links")
    consultant: Consultant = Relationship(back_populates="fieldwork_links")


class Fieldwork(Table, table=True):
    """A fieldwork session. Project, year, collectors and consultants are normalised
    into their own tables."""

    project_id: int | None = Field(default=None, foreign_key="project.id")
    collection_year_id: int | None = Field(
        default=None, foreign_key="collectionyear.id"
    )
    archive: str | None = _text(default=None)
    data_entered_by: str | None = _text(default=None)

    project: Project | None = Relationship(back_populates="fieldworks")
    collection_year: CollectionYear | None = Relationship(back_populates="fieldworks")
    data_collector_links: list[FieldworkDataCollector] = Relationship(
        back_populates="fieldwork"
    )
    consultant_links: list[FieldworkConsultant] = Relationship(
        back_populates="fieldwork"
    )

    entries: list["Reflex"] = Relationship(back_populates="fieldwork")


class SourceEntries(Table, table=True):
    """Link table between Reflex and Source (citation with a role and order)."""

    role: str = _text(index=True)  # primary | secondary | cited | ...
    order: int = Field(default=1, sa_type=Integer())
    pages: str | None = _text(default=None)  # page number as printed, per Reflex

    entry_id: int | None = Field(default=None, foreign_key="reflex.id")
    source_id: int | None = Field(default=None, foreign_key="source.id")

    reflex: "Reflex" = Relationship(back_populates="sources")
    source: "Source" = Relationship()


# ---------------------------------------------------------------------------
# BLR (Bantu Lexical Reconstructions) models
# ---------------------------------------------------------------------------


class BLRContributor(Table, table=True):
    """Person who added a BLR entry (Added by)."""

    name: str | None = _text(default=None)

    blr_entries: list["Reconstruction"] = Relationship(back_populates="contributor")


class BLRReliability(Table, table=True):
    """Reliability score of a BLR reconstruction (Fiab:)."""

    value: str | None = _text(default=None)

    blr_entries: list["Reconstruction"] = Relationship(back_populates="reliability")


class BLRConsonantStructure(Table, table=True):
    """Consonant profile shared across BLR entries."""

    c1: str | None = _text(default=None)
    c2: str | None = _text(default=None)
    c3: str | None = _text(default=None)
    c4: str | None = _text(default=None)
    cs: str | None = _text(default=None)

    blr_entries: list["Reconstruction"] = Relationship(
        back_populates="consonant_structure"
    )


class BLRVowelStructure(Table, table=True):
    """Vowel profile shared across BLR entries."""

    v11: str | None = _text(default=None)
    v12: str | None = _text(default=None)
    v21: str | None = _text(default=None)
    v22: str | None = _text(default=None)
    v3: str | None = _text(default=None)
    v4: str | None = _text(default=None)

    blr_entries: list["Reconstruction"] = Relationship(back_populates="vowel_structure")


class BLRToneStructure(Table, table=True):
    """Tone profile shared across BLR entries."""

    t11: str | None = _text(default=None)
    t12: str | None = _text(default=None)
    t21: str | None = _text(default=None)
    t22: str | None = _text(default=None)
    t3: str | None = _text(default=None)
    t4: str | None = _text(default=None)

    blr_entries: list["Reconstruction"] = Relationship(back_populates="tone_structure")


class Reconstruction(Table, table=True):
    """A single BLR (Bantu Lexical Reconstructions) entry."""

    blr_index: int | None = Field(default=None, index=True)
    word_tone: str | None = _text(default=None)
    word: str | None = _text(default=None)
    english: str | None = _text(default=None)
    french: str | None = _text(default=None)
    noun_class: str | None = _text(default=None)
    distribution: str | None = _text(default=None)
    note: str | None = _text(default=None)
    proto_kk: str | None = _text(default=None)
    date_of_entry: str | None = _text(default=None)

    contributor_id: int | None = Field(default=None, foreign_key="blrcontributor.id")
    reliability_id: int | None = Field(default=None, foreign_key="blrreliability.id")
    consonant_structure_id: int | None = Field(
        default=None, foreign_key="blrconsonantstructure.id"
    )
    vowel_structure_id: int | None = Field(
        default=None, foreign_key="blrvowelstructure.id"
    )
    tone_structure_id: int | None = Field(
        default=None, foreign_key="blrtonestructure.id"
    )

    contributor: BLRContributor | None = Relationship(back_populates="blr_entries")
    reliability: BLRReliability | None = Relationship(back_populates="blr_entries")
    consonant_structure: BLRConsonantStructure | None = Relationship(
        back_populates="blr_entries"
    )
    vowel_structure: BLRVowelStructure | None = Relationship(
        back_populates="blr_entries"
    )
    tone_structure: BLRToneStructure | None = Relationship(back_populates="blr_entries")

    linked_entries: list["Reflex"] = Relationship(back_populates="blr_entry")


# ---------------------------------------------------------------------------


class Reflex(Table, table=True):
    """A single lexical Reflex."""

    # Original spreadsheet IDs
    original_id: int | None = None
    # beginning_id is the primary business identifier and must be unique
    beginning_id: int | None = Field(default=None, unique=True, index=True)

    term: str | None = _text(default=None)
    term_morph_analysis: str | None = _text(default=None)
    translation: str | None = _text(default=None)
    meaning: str | None = _text(default=None)
    scientific_name: str | None = _text(default=None)
    semantic_field: str | None = _text(default=None)
    part_of_speech: str | None = _text(default=None)
    blr_index: str | None = _text(default=None)
    ipa: str | None = _text(default=None)
    notes: str | None = _text(default=None)

    # Foreign Keys
    variety_id: int | None = Field(default=None, foreign_key="variety.id")
    location_id: int | None = Field(default=None, foreign_key="location.id")
    fieldwork_id: int | None = Field(default=None, foreign_key="fieldwork.id")
    blr_entry_id: int | None = Field(default=None, foreign_key="reconstruction.id")

    # Relationships
    variety: Variety | None = Relationship(back_populates="entries")
    location: Location | None = Relationship(back_populates="entries")
    fieldwork: Fieldwork | None = Relationship(back_populates="entries")
    sources: list[SourceEntries] = Relationship(back_populates="reflex")
    blr_entry: Reconstruction | None = Relationship(back_populates="linked_entries")
