# BantuLex admin

The `admin/` folder of the BantuLex repository: a local SQLite editor built with Crouton, NestJS, Vue 3, TypeScript, Vite and Nx. Every database table has a navigation entry; every column is available in detail views and all business fields are editable. IDs and timestamps are managed by SQLite.

## Run

All commands below run from `admin/`. The database is the repository's `data/bantulex.db` (the root `data/` folder, not in git) and startup backups go to the repository's `backups/` folder; both are mounted into the containers by `docker-compose.yml`.

Everything runs in Docker; Node, pnpm and the tests are never run on the host. The only host requirement is Docker (with Compose). Two images are built from the `Dockerfile`:

- **`bantulex`** (production, the default target): see [Docker](#docker).
- **`bantulex-dev`** (`dev` target): Node 24.21.0, pnpm 11.9.0, Python 3 and the `pmtiles` CLI; no browser. It is used by the compose `dev` and `e2e` services, which mount `admin/` at `/app`, the root `data/` at `/app/data` and the root `backups/` at `/app/backups`, and keep a Linux-only `node_modules` in the `dev_node_modules` volume. On every start it runs `pnpm install --frozen-lockfile` and `pnpm run setup` (Crouton patches, Prisma client) and downloads the basemap if it is missing (see [Coordinate maps](#coordinate-maps)), so a lockfile change only needs a new run.

Development with hot reload:

```sh
docker compose --profile dev up dev
```

Open http://127.0.0.1:5555/admin/. The API listens at http://127.0.0.1:4444/api; ports are published on localhost only. No login is needed. One-off commands run in the same toolchain, for example `docker compose run --rm dev pnpm crouton --help`.

The production app is served at http://127.0.0.1:4444/admin/, including browser deep links; `/` redirects there. The UI base path is set by `base` in `apps/frontend/vite.config.ts` and `uiBase` in `apps/backend/src/main.ts`; the API stays at `/api`. `HOST` sets the listen address of both servers (default `127.0.0.1`; the containers use `0.0.0.0`).

Normal operation edits the repository's **data/bantulex.db**. Use Create or Save to persist a form, Cancel to discard it, and the confirmation dialog to delete a record. Referenced records cannot be deleted until their links are removed.

## Docker

The `Dockerfile` builds one self-contained image on `node:24.21.0-trixie-slim`. It serves the UI on `/admin/` and the API on `/api`, and the runtime image includes `python3` for the startup backup. The database is **not** in the image. Mount a directory containing `bantulex.db` at `/app/data`; without it the container exits with "Database does not exist". Startup backups go to `/app/backups`.

```sh
docker build -t bantulex .
docker run -d -p 127.0.0.1:4444:4444 -v "$PWD/../data:/app/data" -v "$PWD/../backups:/app/backups" bantulex
# or: docker compose up -d   (same mounts)
```

The build downloads the basemap from the newest Protomaps daily build; `--build-arg PMTILES_BUILD=YYYYMMDD` pins one (old builds are deleted upstream).

Open http://localhost:4444/admin/. The container runs as uid 1000 (`node`), so both mounted directories must be writable by that uid; SQLite also writes journal files next to the database. `HOST`, `PORT`, `DATABASE_PATH` and `BACKUP_DIR` can be overridden with `-e`. There is no login, so publish the port only on localhost or behind an authenticating reverse proxy. The build stage needs about 2 GB of free Docker disk.

## Database

`DATABASE_PATH` (default `data/bantulex.db`) and `BACKUP_DIR` (default `backups`) resolve relative to `admin/` (the folder containing `crouton.json`), regardless of the launch directory; in the containers that is `/app`, where the root `data/` and `backups/` folders are mounted. Set `DATABASE_PATH` to use a different file and `PORT` to change the backend port. The server refuses to create a missing database. A consistent SQLite backup is saved in the backup folder on startup before any application writes; `BACKUP_DIR` overrides its location. Stop the app before restoring a backup. Backups are retained until you remove them.

No migrations, seeds, resets, `db push`, or automatic schema synchronization run. The database and its schema come from the importer (`just reset-db` and `just import` in the repository root). Its timestamp defaults and `update_<table>_modtime` triggers are authoritative: Prisma never writes `created_at` or `updated_at`.

## Configuration

`crouton.json` configures the title, navigation groups, resource directories, and explicit saving. Each `apps/backend/src/app/resources/<table>/resource.json` configures endpoints, columns, controls, layout, lookup URLs, and visibility. Generated Prisma/Zod files are build artifacts; JSON resources are the maintained application definition.

The default datasource adapter only bounds page sizes and sorts lists by `id` by default. Every table, including the junctions `fieldworkdatacollector` and `fieldworkconsultant`, has an integer `id`; the junctions have a unique (fieldwork, person) pair. Ordinary CRUD, validation, search, pagination, forms, modals, and navigation are provided by Crouton.

`pnpm run setup` (run automatically by the dev container) generates clients and types from the committed introspected schema without modifying the database.

When the importer's schema changes (`utils/utilities/src/utilities/model.py`):

1. Print the introspected schema with `docker compose run --rm dev pnpm exec prisma db pull --print --config prisma/default/prisma.config.ts` and copy it into `prisma/default/schema.prisma`. Keep `created_at`/`updated_at` as `String @default(dbgenerated("CURRENT_TIMESTAMP"))`, so Prisma keeps the importer's `YYYY-MM-DD HH:MM:SS` text instead of writing ISO timestamps.
2. Edit the affected `resource.json` files by hand, following an existing resource: lookups for foreign keys, a `display_label` and `<name>_label` calculated columns, and form controls.
3. Regenerate `tests/inventory.json` with `docker compose run --rm --no-deps utils python3 /app/admin/scripts/inventory.py` (from the repository root) and run the tests.

`pnpm crouton update resources` is not used: it does nothing for this custom datasource, and with a generic one it would rename every model and field to PascalCase/camelCase.

## Verification

```sh
docker compose run --rm dev sh -c "pnpm typecheck && pnpm build && pnpm test"
```

The API tests (`pnpm test`) copy `data/bantulex.db` (in the container: the mounted root database, opened read-only) to the system temporary directory and run local test servers on the copy; they never write to the real database. They check every table/column, independent SQLite persistence, server restart, constraints, nulls, search, and unique junction pairs. `tests/bulk.test.mjs` imports 5,000 rows and checks the dry run, the rollback of an invalid import and undo.

The browser tests (Playwright) do not run a browser in the container: they drive a Chrome on the host over the DevTools protocol (`tests/browser/fixtures.ts`). Chrome 136+ refuses remote debugging on the default profile, so start a dedicated instance with its own profile:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 \
  --user-data-dir="$TMPDIR/bantulex-e2e-chrome" --headless=new
docker compose --profile dev run --rm --service-ports e2e
```

The `e2e` service runs `pnpm test:e2e` with the same mounts as `dev`. It connects to `PW_CDP_URL` (default `http://host.docker.internal:9222`) and publishes the test server on `127.0.0.1:14445`, where the host Chrome opens it. Each test gets a fresh browser context; Chrome is left running, so stop it yourself afterwards. Browser tests cover form visibility, populated edits, creation, cancellation, deletion, relation controls and the map, also on disposable database copies.

## Framework compatibility

Runtime dependencies use exact published Crouton API/Vue/core/generator **0.0.1-alpha.82** and CLI **0.0.1-alpha.81**. Do not replace these with the npm `latest` tag: it points at an older release (use the `alpha` tag).

`scripts/patch-crouton.mjs`, run by postinstall and setup, applies narrowly scoped corrections to the pinned distribution. Each patch locates its (content-hashed) file by the code it rewrites, is idempotent, and prints a warning instead of failing when upstream has changed the target:

- Emit pagination requests directly instead of wrapping them in `requestData`.
- Preserve valid empty TEXT values separately from SQL NULL.
- Connect the generic autocomplete’s existing Clear control to clearing the stored foreign key.
- Use SQLite placeholders for calculated-column queries (readable relation labels and map data).

These are framework fixes, not replacement application forms. Since alpha.82, unique-constraint violations are returned by Crouton as field validation errors (HTTP 400, code `unique`) rather than by the application's 409 mapping.

## Bulk import

*Lexical data → Bulk import* (`/admin/crouton/bulk-import`) adds many reflexes at once, for example all words of a newly digitised dictionary. It is a wizard in four steps (an accordion; each step shows whether it is done):

1. **Download the template** (`bantulex-bulk-import.xlsx`). The "Reflexes" sheet has one column per field: Term (required) and Translation, Meaning (English), Part of speech, Morphology, Semantic field, Scientific name, Pages, Notes, BLR index (optional). Each header has a comment explaining the column; the "Instructions" sheet has a how-to and an example.
2. **Link or create the related records**, the same for every row: a. import label and note; b. the source (pick or create) and its role; c. the variety (pick, create or none); d. location and fieldwork (optional).
3. **Upload and check the file** (at most 20,000 rows per import). The filled-in template is read in the browser (ExcelJS, loaded only on this page). Rows are shown for review in one scrolling grid (no pages; only the visible rows are drawn) where small corrections can be made; larger changes go through the Excel file; rows without a term must be fixed, BLR text that is not a number is kept as a note. *Check against the database* runs the whole import and rolls it back, and marks unknown BLR indexes. Messages give the Excel row number. Columns not in the template are ignored with a warning.
4. **Process the import.** One request, one SQLite transaction: either all rows are saved or none.

BLR indexes follow the importer: a number, or "X ipv Y" (X is used); other text is kept in `blr_note`.

Every import is a batch (`bulkimport`, listed under *Sources → Bulk imports*); its reflexes carry `bulkimport_id`. *Undo* in "Previous imports" deletes the batch's reflexes and source links in one transaction, and the source or variety the batch created if nothing else uses them; the batch stays listed as `undone`. The wizard's choices and uploaded rows are kept in the browser until the import is processed.

API: `POST /api/bulk/reflex[?dryRun=1]` (up to 20,000 rows, JSON body up to 25 MB), `GET /api/bulk/imports`, `POST /api/bulk/imports/:id/undo`. While a bulk transaction runs (about a second for 5,000 rows) other admin requests wait, because the admin uses one SQLite connection. The table and column come from `model.py`; an existing database gets them with `just migrate-db` in the repository root.

## Coordinate maps

The Coordinates page shows every valid coordinate below the table, regardless of table pagination or filters. Open a coordinate’s View action for its detail map. Pins show the ID, description, and latitude/longitude; list pins link to the detail view. Missing or out-of-range coordinates are counted but not plotted. Closing an editing overlay reloads map data; Refresh map also reloads it explicitly.

MapLibre GL JS 6.11 renders the local `apps/frontend/public/maps/world.pmtiles` archive (served at `/admin/maps/world.pmtiles`) through the `pmtiles` protocol. The archive is not in git: `scripts/fetch-basemap.sh` extracts zoom levels 0–4 (about 6 MB) of the newest [Protomaps](https://docs.protomaps.com/basemaps/downloads) daily build with go-pmtiles. The `Dockerfile` runs it at image build time and the dev entrypoint runs it when the file is missing; delete the file and restart the dev container to refresh it. Vite and the production Express server support its HTTP range requests. The archive is a small overview basemap, so fine street detail is limited. Attribution remains visible. No access token, hosted style or external tile service is needed.

`apps/frontend/src/maps/config.json` configures the resource endpoint, archive, paging and zoom. The coordinate resource JSON defines the read-only calculated map data and renderer format. The frontend wraps Crouton’s original resource view and registers its read-only renderer; CRUD remains in Crouton. Map tests check all-row coverage, detail pins and PMTiles range delivery using a disposable database.
