# Database Architecture and Project Structure (BantuLex)

This document provides a technical overview of the BantuLex project repository structure and its comprehensive database models.

## 1 Project Structure

The project is organized into modular directories, separating the Python import/export logic from the administrative interface and the mapping frontend.

```text
.
├── caddy/                  # Reverse proxy configuration (Caddyfile)
├── data/                   # Gitignored: SQLite database and Excel sources
├── admin/                  # Crouton admin app (NestJS API + Vue UI) editing data/bantulex.db; see admin/README.md
├── local-map/              # Static MapLibre GL JS frontend (phonological map)
├── utils/                  # Python backend utilities (UV-managed)
│   ├── importer/           # Excel-to-SQLite pipeline
│   ├── exporter/           # SQLite-to-GeoJSON and Excel (EvoLex) exporters
│   └── utilities/          # Core: SQLModel definitions and DB configuration
├── compose.yml             # System orchestration
└── justfile                # Project command runner (automation)
```

## 2 Database Engine: SQLite STRICT

> **Note:** the importer (`utils/`) currently writes to **Postgres** (`DATABASE_URL` in `utils/utils.env`), so the SQLite-specific helpers below no longer match `model.py`. The Crouton admin edits the SQLite file `data/bantulex.db`, whose 22 tables are STRICT. Nothing currently syncs Postgres and that file; a Postgres datasource for the admin is future work.

The project uses **SQLite in STRICT mode** to ensure maximum data integrity at the database level. Because SQLite STRICT mode is more restrictive than standard SQLite, the models in `utilities/model.py` use custom helpers to ensure compatibility:

*   `_text`: Explicitly using `TEXT` (as `VARCHAR` is not supported in STRICT mode).
*   `_real`: Explicitly using `REAL`.
*   **Boolean handling**: SQLite STRICT does not support a BOOLEAN type; these fields are stored as `INTEGER` (0 for false, 1 for true).

## 3 Database Models

Models are organized by their role in the BantuLex linguistics management workflow.

### 3.1 Primary Entities (Linguistic Data)

These models contain the core research data and are the primary focus of the admin app. All primary and procedural models inherit `id`, `created_at`, and `updated_at` from a common base class.

#### Reflex (Entry)
A single linguistic record for a specific term in a specific variety.
*   **Fields**: `original_id`, `beginning_id` (unique business ID), `term`, `term_morph_analysis`, `translation`, `meaning`, `scientific_name`, `semantic_field`, `part_of_speech`, `blr_index`, `ipa`, `notes`.
*   **Relationships**: Linked to `Variety`, `Location`, `Fieldwork`, and `Reconstruction` (BLR).

#### Reconstruction (BLR Entry)
A Bantu Lexical Reconstruction (BLR) from the benchmark dataset.
*   **Fields**: `blr_index`, `word_tone`, `word`, `english`, `french`, `noun_class`, `distribution`, `note`, `proto_kk`, `date_of_entry`.
*   **Relationships**: Links to phonological structures (Vowel/Consonant/Tone), `BLRContributor`, and `BLRReliability`.

#### Variety
A specific Bantu language variety/dialect.
*   **Fields**: `name_english`, `name_french`, `name_bantu`, `name_bastin`, `branch`, `bastin_index`, `guthrie_index`, `guthrie_plus`, `substrate_suspect` (INTEGER 0/1).

#### Source
Bibliographic references.
*   **Fields**: `author_year`, `year_uncertain` (INTEGER 0/1), `title`.
*   **Relationships**: Linked to `Reflex` entries via `SourceEntries`.

### 3.2 Geographic & Procedural Models

#### Location / Place / Region / Country
Normalized geographic hierarchy for linguistic fieldwork.
*   **Coordinates**: Stored in a separate `Coordinate` table allowing multiple points (e.g., 'default' vs 'original') per location.

#### Fieldwork
Metadata about a data collection event.
*   **Fields**: `archive`, `data_entered_by`.
*   **Relationships**: Links to `Project`, `CollectionYear`, `DataCollector` (multiple), and `Consultant` (multiple).

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

#### BLR Structures (Consonant/Vowel/Tone)
Fixed-slot phonological profiles (e.g., C1, V22, T1). These are kept as dedicated tables to support the **Klankzoeker** sound search feature.

### 3.4 Joins & Ordering

#### SourceEntries
Connects `Reflex` to `Source` with roles and sequence.
*   **Fields**: `role` (primary/cited), `order` (1, 2, 3...), `pages`.

#### FieldworkConsultant / FieldworkDataCollector
Many-to-Many join tables ensuring normalization of persons involved in fieldwork.

## 4 Entity Relationship Matrix

| Source Model | Destination Model | Relationship Type | Purpose |
| :--- | :--- | :--- | :--- |
| **Reflex** | Variety | Many-to-One | Classification |
| **Reflex** | Location | Many-to-One | Geographic Mapping |
| **Reflex** | Reconstruction | Many-to-One | BLR Linkage |
| **Reflex** | Fieldwork | Many-to-One | Data Provenance |
| **SourceEntries** | Reflex | One-to-Many | Bibliographic Evidence |
| **Fieldwork** | Project | Many-to-One | Administrative Grouping |
| **Location** | Place | Many-to-One | Geo-hierarchy |
| **Coordinate** | Location | Many-to-One | Mapping Points |

---
*Last Updated: April 15, 2026*
