# BantuLex Crouton implementation

Use pinned published Crouton API/Vue/core/generator alpha.82 and CLI alpha.81 (originally built on alpha.75). NestJS, Vue, TypeScript, Vite and Nx; local editor with explicit Save/Cancel. Preserve all 22 tables and 183 columns in data/bantulex.db. No migration, reset, seed, or schema sync. Backup before application writes.

1. Install compatible packages and establish SQLite connection.
2. Introspect with Prisma and generate resource schemas using Crouton.
3. Configure every table/field in resource JSON, including searchable FK controls.
4. Extend the existing adapter only for the fieldworkdatacollector compound key.
5. Verify every resource, business field, metadata protection, constraints, and persistence on disposable database copies.
6. Build/typecheck and exercise browser CRUD, including production deep links. Deliver runnable local URL and documentation.

Use existing Crouton fixes as package patches if released forms expose known defects. No replacement CRUD framework. Preserve distinct entry/reflex and blrentry/reconstruction datasets. Use server-side pagination and bounded lookups. Real data receives only final read-only verification; tests use copies.
