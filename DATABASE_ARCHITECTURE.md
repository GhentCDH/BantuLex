# Database Architecture and Project Structure (BantuLex)

This document provides a technical overview of the BantuLex project repository structure and its database models.

## 1 Project Structure

The project is organized into modular directories, separating the Python import/export logic from the administrative interface.

```text
.
├── .github/workflows/      # CI: builds the admin image, publishes it to GHCR on v* tags
├── admin/                  # Crouton admin app (NestJS API + Vue UI) editing data/bantulex.db; see admin/README.md
├── data/                   # Gitignored: Excel sources, exports and the SQLite database (bantulex.db)
├── utils/                  # Python tools (uv workspace)
│   ├── importer/           # Excel → SQLite pipeline
│   ├── exporter/           # SQLite → EvoLex Excel and to-fix worklist (HTML)
│   ├── documenter/         # Generates the data model diagram (just generate-diagram)
│   └── utilities/          # Shared: SQLModel definitions, DB connection, config
├── compose.yml             # Local development services
└── justfile                # Project command runner (automation)
```

The map frontend lives in a separate project.

## 2 Database Engine

The canonical model is `utils/utilities/src/utilities/model.py`. The importer writes it to the **SQLite** file `data/bantulex.db` (`DB_PATH` in `utils/utils.env`); `just reset-db` backs up and removes that file before a fresh import. Column helpers in `model.py`:

*   `_text`: unbounded `TEXT` columns.
*   `_float`: double-precision `FLOAT` columns.
*   `_ts`: timestamp columns, used for `created_at`/`updated_at` (server default `CURRENT_TIMESTAMP`; an `update_<table>_modtime` trigger refreshes `updated_at` on every `UPDATE`, including edits from the admin).
*   Booleans are stored as `0`/`1` integers.

The Crouton admin edits the same file. Its Prisma schema (`admin/prisma/default/schema.prisma`) is introspected from it; when `model.py` changes, update the schema and the admin resources as described in `admin/README.md`.

## 3 Database Models

Models are organized by their role in the BantuLex linguistics management workflow. All models inherit `id`, `created_at` and `updated_at` from a common `Table` base class.

### 3.1 Primary Entities (Linguistic Data)

#### Reflex
A single lexical record for a specific term in a specific variety.
*   **Fields**: `original_id`, `beginning_id` (unique business ID; empty for rows split off with a duplicate ID), `term`, `term_morph_analysis`, `translation`, `meaning`, `scientific_name`, `semantic_field`, `part_of_speech`, `reconstruction_note` (BLR Index text that did not become a plain link; the BLR number is read via `blr_entry_id`), `ipa`, `notes_on_ipa`, `notes`.
*   **Relationships**: Linked to `Variety`, `Location`, `Fieldwork` and `Reconstruction` (via `blr_entry_id`); sources via `SourceEntries`.

#### Reconstruction
A Bantu Lexical Reconstruction (BLR) from the benchmark dataset.
*   **Fields**: `blr_index`, `word_tone`, `word`, `english`, `french`, `noun_class`, `distribution`, `note`, `proto_kk`, `date_of_entry`.
*   **Relationships**: Links to the consonant, vowel and tone structures, `BLRContributor` and `BLRReliability`.

#### Variety
A specific Bantu language variety/dialect.
*   **Fields**: `name_english`, `name_french`, `name_bantu`, `name_bastin`, `branch`, `branch_detailed`, `bastin_index`, `guthrie_index`, `guthrie_plus`, `substrate_suspect` (boolean).

#### Source
Bibliographic references.
*   **Fields**: `author_year`, `year_uncertain` (boolean), `title`.
*   **Relationships**: Linked to `Reflex` entries via `SourceEntries`.

### 3.2 Geographic & Procedural Models

#### Location / Place / Region / Country
Geographic data for linguistic fieldwork. A `Region` belongs to a `Country` and a `Place` to a `Region`; a `Location` links directly to a `Place`, `Region` and `Country` (each optional).
*   **Coordinates**: Stored in a separate `Coordinate` table (`latitude`, `longitude`, `description`, `coordinate_source`), allowing multiple points per location (`description` is `default` or `original`).

#### Fieldwork
Metadata about a data collection event.
*   **Fields**: `archive`, `data_entered_by`.
*   **Relationships**: Links to `Project`, `CollectionYear`, `DataCollector` (multiple) and `Consultant` (multiple).

#### Project
A research project (`name`), linked to `Fieldwork`.

#### CollectionYear
A year of data collection with its certainty status.
*   **Fields**: `value`, `status` (known/uncertain/unknown).
*   **Relationships**: Linked to `Fieldwork`.

### 3.3 Supporting Taxonomies

#### Consultant
Linguistic informants participating in fieldwork.
*   **Fields**: `name`.

#### DataCollector
Researchers performing the fieldwork.
*   **Fields**: `name`.

#### BLRContributor / BLRReliability
Who added a reconstruction (`name`) and its reliability score (`value`).

#### BLR Structures (Consonant/Vowel/Tone)
Fixed-slot phonological profiles shared across reconstructions: `BLRConsonantStructure` (`c1`–`c4`, `cs`), `BLRVowelStructure` (`v11`, `v12`, `v21`, `v22`, `v3`, `v4`) and `BLRToneStructure` (`t11`, `t12`, `t21`, `t22`, `t3`, `t4`). These are kept as dedicated tables to support the **Klankzoeker** sound search in the map.

### 3.4 Joins & Ordering

#### BulkImport
A batch of reflexes added through the admin's bulk import, so the whole batch can be undone.
*   **Fields**: `label`, `note`, `rows`, `status` (`saved` or `undone`), `undone_at`, `role`, the shared links `source_id`, `variety_id`, `location_id`, `fieldwork_id`, and `source_created`/`variety_created` (the batch created that record).
*   `reflex.bulkimport_id` points to the batch; it is NULL for reflexes from the spreadsheet import.

#### SourceEntries
Connects `Reflex` to `Source` with roles and sequence.
*   **Fields**: `role` (`primary` or `cited`), `order` (1, 2, 3...), `pages`, `entry_id` (→ `Reflex`), `source_id` (→ `Source`).

#### FieldworkConsultant / FieldworkDataCollector
Many-to-many link tables with a surrogate `id` and a unique constraint on the pair (`fieldwork_id`, `data_collector_id`/`consultant_id`), ensuring normalization of persons involved in fieldwork.

## 4 Entity Relationship Matrix

| Source Model | Destination Model | Relationship Type | Purpose |
| :--- | :--- | :--- | :--- |
| **Reflex** | Variety | Many-to-One | Classification |
| **Reflex** | Location | Many-to-One | Geographic Mapping |
| **Reflex** | Reconstruction | Many-to-One | BLR Linkage |
| **Reflex** | Fieldwork | Many-to-One | Data Provenance |
| **SourceEntries** | Reflex | Many-to-One | Bibliographic Evidence |
| **SourceEntries** | Source | Many-to-One | Bibliographic Evidence |
| **Fieldwork** | Project | Many-to-One | Administrative Grouping |
| **Fieldwork** | CollectionYear | Many-to-One | Dating |
| **Location** | Place / Region / Country | Many-to-One | Geo-hierarchy |
| **Coordinate** | Location | Many-to-One | Mapping Points |
| **Reconstruction** | BLR structures, contributor, reliability | Many-to-One | Phonological Profile |

---
*Last Updated: October 12, 2026*
