# BantuLex Architecture

This document describes the structure and deployment architecture of the BantuLex project, matching the transition from Docker Compose (local development) to Nomad (target production environment).

## Infrastructure Overview

```mermaid
graph TB
    subgraph "Docker Compose (local dev)"
        style "Docker Compose (local dev)" fill:#f8fafc,stroke:#cbd5e1,stroke-width:2px,color:#475569

        caddy_dev["caddy<br/><small>caddy:2-alpine :80</small>"]
        style caddy_dev fill:#ffffff,stroke:#64748b,stroke-width:1.5px

        kottster_dev["kottster<br/><small>local build :5480<br/>source-mounted, dev.sh</small>"]
        style kottster_dev fill:#eff6ff,stroke:#3b82f6,stroke-width:2px,color:#1e40af

        map_dev["bantulex-map<br/><small>local build :80<br/>Caddy + static files</small>"]
        style map_dev fill:#ffffff,stroke:#64748b,stroke-width:1.5px

        import_dev["import<br/><small>CLI tool - not deployed</small>"]
        style import_dev fill:none,stroke:#94a3b8,stroke-width:1px,stroke-dasharray: 5 5,color:#64748b

        export_dev["export<br/><small>CLI tool - not deployed</small>"]
        style export_dev fill:none,stroke:#94a3b8,stroke-width:1px,stroke-dasharray: 5 5,color:#64748b

        db_dev[("./data/bantulex.db")]
        style db_dev fill:#fffbeb,stroke:#f59e0b,stroke-width:2px,color:#92400e

        caddy_dev --> kottster_dev
        caddy_dev --> map_dev
        import_dev -.-> db_dev
        export_dev -.-> db_dev
        kottster_dev -.-> db_dev
        map_dev -.-> db_dev
    end

    subgraph "Nomad Job: bantulex (target)"
        style "Nomad Job: bantulex (target)" fill:#ecfdf5,stroke:#10b981,stroke-width:2px,color:#065f46

        gateway["gateway<br/><small>caddy:latest :80</small>"]
        style gateway fill:#ffffff,stroke:#64748b,stroke-width:1.5px

        data_mgmt["data_management<br/><small>ghcr.io/ghentcdh/bantulex:main<br/>Kottster on /data/admin<br/>pre-built container, :8000</small>"]
        style data_mgmt fill:#eff6ff,stroke:#3b82f6,stroke-width:2px,color:#1e40af

        data_pub["data_publishing<br/><small>caddy + static<br/>no back-end<br/>data view on :3000</small>"]
        style data_pub fill:#ffffff,stroke:#64748b,stroke-width:1.5px

        vault["Vault: nomad/kv/ghentcdh/bantulex"]
        style vault fill:#f5f3ff,stroke:#8b5cf6,stroke-width:1.5px,color:#5b21b6

        db_nomad[("CSI/SMB Volume: bantulex.db")]
        style db_nomad fill:#fffbeb,stroke:#f59e0b,stroke-width:2px,color:#92400e

        gateway -- "/data/admin*" --> data_mgmt
        gateway -- "/*" --> data_pub
        data_mgmt -.-> vault
        data_mgmt -.-> db_nomad
        data_pub -.-> db_nomad
    end

    subgraph "Container Build Required"
        style "Container Build Required" fill:#fef2f2,stroke:#ef4444,stroke-width:2px,color:#991b1b

        build_tool["ghcr.io/ghentcdh/bantulex:main<br/><small>Kottster app - pre-built - no source mounts<br/>configured for sub-path /data/admin</small>"]
        style build_tool fill:#ffffff,stroke:#ef4444,stroke-width:2px,color:#991b1b

        no_build["No custom build needed<br/><small>gateway -> stock caddy:latest<br/>data_publishing -> stock caddy + static files from volume</small>"]
        style no_build fill:#ecfdf5,stroke:#10b981,stroke-width:1.5px,color:#065f46
    end

    build_tool -. "red dashed = target build pipeline" .-> data_mgmt

## Legend

- <span style="color:#3b82f6">■</span> **Custom container (needs CI/CD build)**
- <span style="color:#64748b">■</span> **Stock / config-only container**
- <span style="color:#94a3b8">◌</span> **Dev-only (not deployed)**
- <span style="color:#f59e0b">■</span> **Persistent data**
- <span style="color:#8b5cf6">■</span> **Secrets (Vault)**
- <span style="color:#ef4444">---</span> **The one required build pipeline**
 
## Data Model & Normalization

The BantuLex data model follows specific normalization rules to handle complexities in linguistic data while maintaining a clean relationship structure.

### 1. Fieldwork & Consultants
Previously stored as comma-separated strings, data collectors and consultants are now fully normalized:
- **`DataCollector`**: Unique persons who collected the data.
- **`Consultant`**: Unique persons who provided the linguistic information.
- **Link Tables**: `FieldworkDataCollector` and `FieldworkConsultant` handle the Many-to-Many relationship, allowing multiple collectors and consultants to be linked to a single fieldwork session without duplication or string-parsing issues.

### 2. Source Tracking & Ordering
To avoid the anti-pattern of slot-based roles (e.g., `role="second_source"`), the system uses a unified role system combined with explicit ordering:
- **Roles**:
    - `primary`: A direct source for the lexical entry.
    - `cited`: A source cited within a primary source.
- **Ordering**: The `order` column in `SourceEntries` preserves the sequence of sources from the spreadsheet (1, 2, 3...).
- **Exporting**: Exporters (like EvoLex) aggregate all `primary` sources for an entry into a single field, ensuring no bibliographic data is lost.

### 3. BLR Phonological Structures
Phonological positions (C1, V11, T11, etc.) for Bantu Lexical Reconstructions are kept as fixed columns. This is a deliberate choice to support the "Sound Search" (Klankzoeker) functionality in the Map UI, which requires predictable structural slots.

