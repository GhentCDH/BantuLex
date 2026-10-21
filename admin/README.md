# BantuLex admin

The `admin/` folder of the BantuLex repository: a local SQLite editor built with Crouton, NestJS, Vue 3, TypeScript, Vite and Nx. Every database table has a navigation entry; every column is available in detail views and all business fields are editable. IDs and timestamps are managed by SQLite.

## Run

All commands below run from `admin/`. The database is the repository's `data/bantulex.db` (the root `data/` folder, not in git), mounted into the containers by `docker-compose.yml`. The admin makes no backups; copy the file yourself before risky changes.

Everything runs in Docker; Node, pnpm and the tests are never run on the host. The only host requirement is Docker (with Compose). Two images are built from the `Dockerfile`:

- **`bantulex`** (production, the default target): see [Docker](#docker).
- **`bantulex-dev`** (`dev` target): Node 24.21.0, pnpm 11.9.0, Python 3 and the `pmtiles` CLI; no browser. It is used by the compose `dev` and `e2e` services, which mount `admin/` at `/app`, the root `data/` at `/app/data`, and keep a Linux-only `node_modules` in the `dev_node_modules` volume. On every start it runs `pnpm install --frozen-lockfile` and `pnpm run setup` (Crouton patches, Prisma client) and downloads the basemap if it is missing (see [Coordinate maps](#coordinate-maps)), so a lockfile change only needs a new run.

Development with hot reload:

```sh
docker compose --profile dev up dev
```

Open http://127.0.0.1:5555/admin/. The API listens at http://127.0.0.1:4444/api; ports are published on localhost only. No login is needed. One-off commands run in the same toolchain, for example `docker compose run --rm dev pnpm crouton --help`.

The production app is served at http://127.0.0.1:4444/admin/, including browser deep links; `/` redirects there. The UI base path is set by `base` in `apps/frontend/vite.config.ts` and `uiBase` in `apps/backend/src/main.ts`; the API stays at `/api`. `HOST` sets the listen address of both servers (default `127.0.0.1`; the containers use `0.0.0.0`).

Normal operation edits the repository's **data/bantulex.db**. Use Create or Save to persist a form, Cancel to discard it, and the confirmation dialog to delete a record. Referenced records cannot be deleted until their links are removed.

## Docker

The `Dockerfile` builds one self-contained image on `node:24.21.0-trixie-slim`. It serves the UI on `/admin/` and the API on `/api`. The database is **not** in the image. Mount a directory containing `bantulex.db` at `/app/data`; without it the container exits with "Database does not exist".

```sh
docker build -t bantulex .
docker run -d -p 127.0.0.1:4444:4444 -v "$PWD/../data:/app/data" bantulex
# or: docker compose up -d   (same mounts)
```

The build downloads the basemap from the newest Protomaps daily build; `--build-arg PMTILES_BUILD=YYYYMMDD` pins one (old builds are deleted upstream).

Open http://localhost:4444/admin/. The container runs as uid 1000 (`node`), so the mounted data directory must be writable by that uid; SQLite also writes journal files next to the database. `HOST`, `PORT` and `DATABASE_PATH` can be overridden with `-e`. There is no login, so publish the port only on localhost or behind an authenticating reverse proxy. The build stage needs about 2 GB of free Docker disk.

## Database

`DATABASE_PATH` (default `data/bantulex.db`) resolves relative to `admin/` (the folder containing `crouton.json`), regardless of the launch directory; in the containers that is `/app`, where the root `data/` folder is mounted. Set `DATABASE_PATH` to use a different file and `PORT` to change the backend port. The server refuses to create a missing database. The admin does not back up the database; stop the app before replacing `bantulex.db` with a copy.

No migrations, seeds, resets, `db push`, or automatic schema synchronization run. The database and its schema come from the importer (`just reset-db` and `just import` in the repository root). Its timestamp defaults and `update_<table>_modtime` triggers are authoritative: Prisma never writes `created_at` or `updated_at`.

## Configuration

`crouton.json` configures the title, navigation groups, resource directories, and explicit saving. Each `apps/backend/src/app/resources/<table>/resource.json` configures the data source (`source`), endpoints and their search and filter fields (`operations`), columns (computed columns carry `computed.sql`), lookup labels, the form layout (`layout.form.items`, modal size in `layout.form.container`), and visibility. The files follow Crouton's v1 schema (`$schema`); check them with `docker compose run --rm dev pnpm crouton validate --strict`. The main lists (reflexes, reconstructions, varieties, sources, fieldwork) have a filter builder from `layout.table.filterFields`, limited to text fields: Crouton's `contains`/`equals` filters fail (400) on number, boolean and foreign-key columns. Reflexes and reconstructions have a *View on public site* row action (`layout.table.rowActions`, links to `/#/reflex/{id}` and `/#/blr/{blr_index}` on the same host). A table node without `items` keeps all columns; listing `items` limits the table to those columns. Generated Prisma/Zod files are build artifacts; JSON resources are the maintained application definition.

The default datasource adapter only bounds page sizes and sorts lists by `id` by default. Every table, including the junctions `fieldworkdatacollector` and `fieldworkconsultant`, has an integer `id`; the junctions have a unique (fieldwork, person) pair. Ordinary CRUD, validation, search, pagination, forms, modals, and navigation are provided by Crouton.

`pnpm run setup` (run automatically by the dev container) generates clients and types from the committed introspected schema without modifying the database.

When the importer's schema changes (`utils/utilities/src/utilities/model.py`):

1. Print the introspected schema with `docker compose run --rm dev pnpm exec prisma db pull --print --config prisma/default/prisma.config.ts` and copy it into `prisma/default/schema.prisma`. Keep `created_at`/`updated_at` as `String @default(dbgenerated("CURRENT_TIMESTAMP"))`, so Prisma keeps the importer's `YYYY-MM-DD HH:MM:SS` text instead of writing ISO timestamps.
2. Edit the affected `resource.json` files by hand, following an existing resource: lookups for foreign keys, a `display_label` and `<name>_label` computed columns (as relation links), the parent's related-records table, and form controls (see [Relations in the detail view](#relations-in-the-detail-view)).
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

Runtime dependencies use exact published Crouton API/Vue/core/generator/CLI **0.0.1-alpha.88**. Do not replace these with the npm `latest` tag: it points at an older release (use the `alpha` tag). Modal and notification services come from `@ghentcdh/crouton-vue` (it no longer uses `@ghentcdh/ui`).

`scripts/patch-crouton.mjs`, run by postinstall and setup, applies narrowly scoped corrections to the pinned distribution. Each patch locates its (content-hashed) file by the code it rewrites, is idempotent, and prints a warning instead of failing when upstream has changed the target:

- Preserve valid empty TEXT values separately from SQL NULL.
- Use SQLite placeholders for computed-column queries (readable relation labels and map data).
- Build the table and view layouts from regular columns only: computed columns are injected separately, and were otherwise shown twice in tables.
- Leave computed columns out of the default search fields (resources without `operations.findAll.search`, e.g. the fieldwork junctions), since they are not database fields.
- Treat only ISO-like `YYYY-MM-DD` strings as dates in the detail view (otherwise "6641" is shown as a date).

These are framework fixes, not replacement application forms. Since alpha.82, unique-constraint violations are returned by Crouton as field validation errors (HTTP 400, code `unique`) rather than by the application's 409 mapping.

## Reflexes import

*Lexical data → Reflexes import* (`/admin/crouton/bulk-import`) adds many reflexes at once, for example all words of a newly digitised dictionary. It is a wizard in four steps (an accordion; each step shows whether it is done):

1. **Download the template** (`bantulex-bulk-import.xlsx`). The "Reflexes" sheet has one column per field: Term (required) and Translation, Meaning (English), Part of speech, Morphology, Semantic field, Scientific name, Pages, Notes, BLR index (optional). Each header has a comment explaining the column; the "Instructions" sheet has a how-to and an example.
2. **Link or create the related records**, the same for every row: a. the source (pick or create) and its role; b. the variety (pick, create or none); c. location and fieldwork (optional). Each step opens only when the previous one is complete.
3. **Upload and check the file** (at most 20,000 rows per import). The filled-in template is read in the browser (ExcelJS, loaded only on this page). Rows are shown for review in one scrolling grid (no pages; only the visible rows are drawn) where small corrections can be made; larger changes go through the Excel file; rows without a term must be fixed, BLR text that is not a number is kept as a note. *Check against the database* runs the whole import and rolls it back, and marks unknown BLR indexes. Messages give the Excel row number. Columns not in the template are ignored with a warning.
4. **Process the import.** One request, one SQLite transaction: either all rows are saved or none.

BLR indexes follow the importer: a number, or "X ipv Y" (X is linked); other text, the "X ipv Y" text itself and numbers without a reconstruction are kept in `reconstruction_note`.

Every import is a batch named after the local date and time it was processed (e.g. `2027 10 12 - 13h 14`; `bulkimport`, listed under *Sources → Bulk imports*); its reflexes carry `bulkimport_id`. *Undo* in "Previous imports" deletes the batch's reflexes and source links in one transaction, and the source or variety the batch created if nothing else uses them; the batch stays listed as `undone`. The wizard's choices and uploaded rows are kept in the browser until the import is processed.

API: `POST /api/bulk/reflex[?dryRun=1]` (up to 20,000 rows, JSON body up to 25 MB), `GET /api/bulk/imports`, `POST /api/bulk/imports/:id/undo`. While a bulk transaction runs (about a second for 5,000 rows) other admin requests wait, because the admin uses one SQLite connection. The table and column come from `model.py`; an existing database gets them with `just migrate-db` in the repository root.

## Reflexes editor

*Lexical data → Reflexes editor* (`/admin/crouton/bulk-edit`) edits the text fields of existing reflexes (term, translation, meaning, part of speech, morphology, semantic field, scientific name, IPA and its notes, reconstruction note, notes), the BLR index and the variety label in a grid that fills the window. Search uses Crouton's `q`; a variety or a bulk import batch narrows the rows (the variety filter replaces sorting by variety).

The grid has no row-number column; the id is a link that opens the reflex form in Crouton's modal. Columns can be reordered by dragging the `⋮⋮` handle at the left of a header; the order is remembered in `localStorage`, like the column selection and widths. The variety column is edited through its label with a searchable dropdown: typing queries the variety API (up to 20 matches, debounced), and picking a result stores its `variety_id` without creating a variety. An exact, unique label typed without picking still resolves; extra and repeated spaces are ignored. Some varieties share a display label (e.g. `Tege (B71b)` is two rows); those results carry a `[#id]` suffix, and the plain duplicate label is refused until one of them is picked. An unknown label (for example the typo `Tege (B17b)`) leaves the row unsaved with a field error. Clearing the cell clears the relation. Click a column header to sort on the server (`asc`/`desc`, toggling); the API can sort only physical reflex columns, not calculated labels such as variety. Drag the edge between two headers to resize a column; double-click that edge to restore its default width. Widths are remembered in `localStorage`, like the column selection. The *Columns* menu hides or shows columns, remembers the selection in `localStorage`, and keeps at least one column visible. *Rows* selects 20, 50, 100 or 500 rows per page (default 50; the API caps at 500).

Editing goes through Crouton: rows are loaded with the resource's list operation, and a row is saved when the focus leaves it (or with *Save all*, Ctrl/Cmd+S) as one `PATCH /api/reflex/:id` with only the changed fields, after checking them with the zod schema of Crouton's reflex form. Drag the small blue handle at the bottom-right of the focused cell up or down to repeat the selected block in the adjacent rows; releasing saves the filled rows. Read-only cells have no handle.

*BLR index* shows the index of the linked reconstruction (`reflex` has no index column of its own). Like the variety, it is edited as a reference: the grid resolves the number with `GET /api/blr/by-index/:blr` and saves `blr_entry_id`. An index without a reconstruction (or a non-numeric value) is rejected with a field error and the row is not saved; clearing the cell clears the link. A blank *Reconstruction note* is stored as NULL. Dirty rows get an amber marker, saved rows flash green, and rows that could not be saved flash red and are listed by row number in the status line. A cleared cell is sent as `null`. Field errors from the API (`message[]` with `field`) are shown on the cells; rows that could not be saved stay marked (a red left border and tooltip), and changing sort, page size, page or leaving asks before dropping them.

## Reconstruction editor

*Lexical data → Reconstruction editor* (`/admin/crouton/reconstruction-form`) creates a BLR reconstruction or edits an existing one, laid out like the public BLR viewer (`/#/blr/<index>`). On the left are the live heading (`BLR n`, `*word_tone`, the glosses) and the *Sound structure* and *Reconstruction* cards. On the right are the linked reflexes and a picker to add more. Each save is **one transaction**; any failed check rolls all of it back.

- **Open** a reconstruction with the *BLR index* field, `?blr=<index>`, `?id=<id>`, or *Open in → Reconstruction editor* in Crouton's reconstruction view. Without a query the form is empty, for a new reconstruction.
- **New** (`POST /api/blr`): the BLR index is not entered. The API shows `MAX(blr_index) + 1` and assigns it inside the transaction. At least one reflex is required.
- **Edit** (`PUT /api/blr/:id`):
  - The request sends the complete set of reflexes. Reflexes removed from the list (shown struck through until saving, and restorable) are **unlinked**: `blr_entry_id` becomes NULL. New ones are linked.
  - A reconstruction may be left without reflexes (most imported ones have none).
  - The BLR index and the date of entry are not changed.
- **Fields** follow the viewer: word (required), word tone, English, French, noun class, Proto-KK, reliability, contributor and note.
  - Contributor (via the `blrcontributor` resource) and reliability are **dropdowns only**. New contributors are created in their own admin resource.
  - Distribution is a set of **Guthrie zone checkboxes (A–S)**, stored in the space-separated format used in the data.
- **Sound structure:** the grid uses the viewer's `C₁ V₁₁ V₁₂ C₂ V₂₁ V₂₂ C₃ V₃ C₄ V₄ CS` order, with the tone row under the vowels.
  - C/V/T slots are dropdowns of existing values. CS is a searchable list of existing values. Empty slots (∅) are stored as NULL.
  - An identical consonant/vowel/tone tuple is **reused** instead of duplicated. Editing never changes a structure row that other reconstructions share: a changed structure points to a matching or new tuple.
- **The picker** uses Crouton's reflex list (`GET /api/reflex`): `q` search, a variety filter, and by default only reflexes without a reconstruction (`blr_entry_id:0:isnull`). It pages through them and keeps the selection across pages and sorts.
- **Sorting:** click a column header in either reflex table. The linked reflexes are all loaded and sort in the browser. The picker sorts on the server through Crouton's `sort`/`sortDir`. Crouton can only sort physical columns, so the picker's *Variety* (a calculated label) is not sortable; use the variety filter instead.
- **Errors:** if a selected reflex belongs to another reconstruction, or a contributor or reliability is invalid, nothing is saved and the error is shown.
- **Public viewer links:** *View on public site ↗* in the form and in the reconstruction view goes to `/#/blr/<index>` on the same host, where the public site is served next to `/admin/`. The public site never links back to the admin.

Code: `apps/backend/src/app/blr/` (controller, zod schema, service). The frontend lives in `apps/frontend/src/blr/`:

- `api.ts` holds the requests.
- `useReconstruction.ts` and `useBlrOptions.ts` hold the state and the choices.
- `ReconstructionPage.vue` connects the route to the components.
- The components (`ReconstructionHeader`, `ReconstructionFields`, `SoundStructureForm`, `LinkedReflexes`, `ReflexPicker`, …) only render.

## Relations in the detail view

The API returns flat records; the detail (View) modal shows the relations between them through two read-only renderers, registered in `apps/frontend/src/main.ts` and selected by a computed column's `fieldInput.options.format`:

- `relation-link` on a `<name>_label` column: the related record's label as a link to its view, with an *Edit* link, e.g. a reflex's variety, location, fieldwork and BLR entry. Options: `linkResource` (the related resource) and `idKey` (the foreign key column of this record). Tables and forms are unchanged: tables show the plain label, forms the autocomplete.
- `related-table` on a column `<child>_by_<foreign key>` (`computed.sql: SELECT CAST(main.id AS TEXT)`, hidden in tables): a paged table of the records that point to this one, with view and edit links, e.g. the reflexes of a fieldwork. Options: `childResource`, `foreignKey` and `columns` (`[{key, label}]`, shown after the record's `display_label`).

Every `relation-link` has its reverse `related-table` (checked by `tests/relations.test.mjs`). Crouton's own relation columns (`format: relation`) are not used: their labels come from a single field of the related row instead of the composite `display_label`, and a visible one-to-many relation loads all children (thousands of reflexes) with the record. The table queries the list API with `filter=<fk>:<id-1>:gt&filter=<fk>:<id+1>:lt`, because Crouton's `equals` filter is not cast to a number for integer columns.

Crouton opens a record's modal from `?id=&event=` only when its resource view mounts, and its modals are global, so the frontend keys the resource view by resource and closes open modals when navigation changes resource; browser back and forward follow the links.

## Coordinate maps

The Coordinates page shows every valid coordinate below the table, regardless of table pagination or filters. Open a coordinate’s View action for its detail map. Pins show the ID, description, and latitude/longitude; list pins link to the detail view. Missing or out-of-range coordinates are counted but not plotted. Closing an editing overlay reloads map data; Refresh map also reloads it explicitly.

MapLibre GL JS 6.11 renders the local `apps/frontend/public/maps/world.pmtiles` archive (served at `/admin/maps/world.pmtiles`) through the `pmtiles` protocol. The archive is not in git: `scripts/fetch-basemap.sh` extracts zoom levels 0–4 (about 6 MB) of the newest [Protomaps](https://docs.protomaps.com/basemaps/downloads) daily build with go-pmtiles. The `Dockerfile` runs it at image build time and the dev entrypoint runs it when the file is missing; delete the file and restart the dev container to refresh it. Vite and the production Express server support its HTTP range requests. The archive is a small overview basemap, so fine street detail is limited. Attribution remains visible. No access token, hosted style or external tile service is needed.

`apps/frontend/src/maps/config.json` configures the resource endpoint, archive, paging and zoom. The coordinate resource JSON defines the read-only computed map data and renderer format. The frontend wraps Crouton’s original resource view and registers its read-only renderer; CRUD remains in Crouton. Map tests check all-row coverage, detail pins and PMTiles range delivery using a disposable database.
