# BantuLex Architecture

This document describes the structure and deployment architecture of the BantuLex project. Local development uses Docker Compose (`compose.yml`). On the server, the system Caddy serves the static Pihka site and proxies the admin container, which is deployed separately (see [docs/deployment.md](docs/deployment.md)).

## Infrastructure Overview

```mermaid
graph TB
    subgraph dev["Docker Compose (local dev)"]
        caddy_dev["caddy<br/><small>stock caddy :9161<br/>copy of the server's system Caddy<br/>site/ + Pihka mounted live</small>"]
        style caddy_dev fill:none,stroke:#94a3b8,stroke-width:1px,stroke-dasharray: 5 5,color:#64748b

        admin_dev["admin (Crouton)<br/><small>local build of ./admin :4444<br/>UI /admin/, API /api<br/>compose profile admin</small>"]
        style admin_dev fill:#eff6ff,stroke:#3b82f6,stroke-width:2px,color:#1e40af

        utils_dev["utils<br/><small>importer + exporters (CLI)<br/>not deployed</small>"]
        style utils_dev fill:none,stroke:#94a3b8,stroke-width:1px,stroke-dasharray: 5 5,color:#64748b

        db_dev[("./data/bantulex.db<br/><small>SQLite</small>")]
        style db_dev fill:#fffbeb,stroke:#f59e0b,stroke-width:2px,color:#92400e

        exports_dev[("./data exports<br/><small>EvoLex xlsx, to-fix worklist</small>")]
        style exports_dev fill:#fffbeb,stroke:#f59e0b,stroke-width:2px,color:#92400e

        caddy_dev -- "/admin/*, /api/*" --> admin_dev
        caddy_dev -. "/database/bantulex.db" .-> db_dev
        utils_dev -. "import" .-> db_dev
        db_dev -. "export" .-> utils_dev
        utils_dev -.-> exports_dev
        admin_dev -.-> db_dev
    end
    style dev fill:#f8fafc,stroke:#cbd5e1,stroke-width:2px,color:#475569

    subgraph server["Server (gcdhdockqas1)"]
        gateway["system Caddy<br/><small>tst.bantulex.ugent.be<br/>TLS, ugent_only</small>"]
        style gateway fill:#ffffff,stroke:#64748b,stroke-width:1.5px

        data_mgmt["admin<br/><small>ghcr.io/ghentcdh/bantulex<br/>Crouton admin: UI /admin/, API /api<br/>own compose file, 127.0.0.1:8190</small>"]
        style data_mgmt fill:#eff6ff,stroke:#3b82f6,stroke-width:2px,color:#1e40af

        data_pub[("/data/bantulex_tst/public<br/><small>static Pihka site<br/>just deploy</small>")]
        style data_pub fill:#ffffff,stroke:#64748b,stroke-width:1.5px

        db_server[("/data/bantulex_tst/data/bantulex.db")]
        style db_server fill:#fffbeb,stroke:#f59e0b,stroke-width:2px,color:#92400e

        gateway -- "/admin/*, /api/*" --> data_mgmt
        gateway -- "/*" --> data_pub
        gateway -. "/database/bantulex.db" .-> db_server
        data_mgmt -.-> db_server
    end
    style server fill:#ecfdf5,stroke:#10b981,stroke-width:2px,color:#065f46

    subgraph build["Container Build Required"]
        build_tool["ghcr.io/ghentcdh/bantulex<br/><small>Crouton admin - built from admin/Dockerfile<br/>published by CI on v* tags</small>"]
        style build_tool fill:#ffffff,stroke:#ef4444,stroke-width:2px,color:#991b1b

        no_build["No container for the site<br/><small>static files, rsynced by just deploy</small>"]
        style no_build fill:#ecfdf5,stroke:#10b981,stroke-width:1.5px,color:#065f46
    end
    style build fill:#fef2f2,stroke:#ef4444,stroke-width:2px,color:#991b1b

    build_tool -. "red dashed = the build pipeline" .-> data_mgmt
```

Notes:

- In dev, the `caddy` service copies the server's system Caddy block (`Caddyfile`), so the site, the database route and the admin proxy behave as on the server. The admin is also reachable directly on `127.0.0.1:4444`, and the exporters write their files to `data/`.
- The public site and the admin use the same database file. The browser downloads `bantulex.db` and builds its search tables itself, so admin edits are on the site at the next page load. The database is never copied to the server by a deploy (see `docs/publishing.md`).
- The admin has no login: on the server it must sit behind an authenticating reverse proxy. Its UI base path is `/admin/` and its API `/api` (see `admin/README.md`); serving it under another sub-path requires changing that configuration.
- The importer writes the SQLite file `bantulex.db` (`DB_PATH` in `utils/utils.env`), which the exporters read and the admin edits. When the importer's schema changes, the admin's Prisma schema and resources must follow (see `admin/README.md`).

## Legend

- <span style="color:#3b82f6">■</span> **Custom container (needs CI/CD build)**
- <span style="color:#64748b">■</span> **Stock / config-only container**
- <span style="color:#94a3b8">◌</span> **Dev-only (not deployed)**
- <span style="color:#f59e0b">■</span> **Persistent data**
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

Phonological positions (C1, V11, T11, etc.) for Bantu Lexical Reconstructions are kept as fixed columns. This is a deliberate choice to support the "Sound Search" (Klankzoeker) in the map (a separate project), which requires predictable structural slots.
