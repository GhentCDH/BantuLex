# Publishing with Pihka

The public BantuLex website is a static site built on the
[Pihka](https://github.com/GhentCDH/Pihka) engine: static files and one SQLite
database, which the browser queries itself. There is no backend on the server,
only Caddy as a file server. The UI is BantuLex's own (`site/`); it does not use
Pihka's default UI. From Pihka it uses only the query engine (`core/engine`), the
vendored Preact and SQLite WASM (`core/vendor`) and the map extension
(`extensions/point_map`).

```
data/*.xlsx --importer--> Postgres --Dataflow--> SQLite export
    --just site-db--> site/database/bantulex.sqlite (with materialized reflex_search)
    --just build-site--> dist/bantulex/ --just publish--> web server
```

## Layout

| Path | Contents |
| --- | --- |
| `vendor/pihka/` | Git submodule of GhentCDH/Pihka, pinned to one commit. Never edit it here. |
| `site/` | The BantuLex site. It is the web root; `build-site` adds Pihka's `core/` and `extensions/point_map/` beside it. |
| `site/config.json` | Database file and version, perspectives (`reflex_search` is materialized with indexes), the engine plugin and the sound structure inventories. |
| `site/main.js` | Composition root: opens the database with the Pihka engine and mounts the UI. |
| `site/engine/filters.js` | Engine plugin with the BantuLex filter types (`values`, `contains`, `gloss`, `blr-structure`). All SQL lives here. |
| `site/ui/` | Preact UI: views (`search`, `blr`, `reflex`), components (meaning search, sound structure, column filter, results, map), URL state and translations (en, nl). |
| `site/database/` | The prepared database. Gitignored. |
| `dist/` | The built site. Gitignored. |

### Views

- `#/` (search): meaning search, sound structure and a filter on every result
  column, with the reflexes as a table or a map (coloured by BLR index or
  Guthrie zone). All search state is in the URL, so every result can be shared.
- `#/blr/<index>`: one BLR index with its reconstruction, sound structure and
  reflexes. The BLR links in the results go here.
- `#/reflex/<id>`: one reflex with its variety, location, fieldwork, sources and
  reconstruction.

The meaning search matches whole words, case-insensitive for ASCII letters. On
the reflex level, English searches `reflex.meaning` and French searches
`reflex.translation`; on the BLR level it searches `reconstruction.english` or
`reconstruction.french`. The semantic mode is a placeholder for a later
embedding-based search.

Pihka's own documentation explains the engine and the map extension: see
`vendor/pihka/ARCHITECTURE.md` and `vendor/pihka/pihka/extensions/point_map/README.md`.

## First setup

```sh
git clone --recurse-submodules git@github.com:GhentCDH/BantuLex.git
# or, in an existing clone:
just pihka-init
```

The submodule URL is relative (`../Pihka.git`), so it uses the same protocol
(SSH or HTTPS) as your BantuLex clone.

## Steps

1. **Export Postgres to SQLite** with [Dataflow](https://github.com/GhentCDH/Dataflow)
   and `dataflow.config.json`. The config writes to `/out/export.sqlite`; mount
   `./out` there, so the result is `out/export.sqlite`.
2. **`just site-db`** copies the export to `site/database/bantulex.sqlite` and
   adds the perspective views, with `reflex_search` as an indexed table. The
   site does not use full-text search (`"enrichment": {"fts": false}`), so no
   search indexes are built. Run it again after you change `perspectives` in
   `site/config.json`, and raise `databaseVersion` there after every new
   database. Use `BANTULEX_SOURCE_DB=<path>` for a different export. Needs
   Node.js 22.13 or newer.
3. **`just pihka-up`** serves the site on http://localhost:9161. `site/` and
   the Pihka submodule are mounted live: reload the browser after a change.
4. **`just publish`** builds `dist/bantulex` (`site/` plus Pihka's `core/` and
   `extensions/point_map/`) and copies it with rsync. Set the target first:
   `BANTULEX_DEPLOY_TARGET=<host>:/var/www/bantulex/`.

## Server requirements

The site is served at http://bantulex.ugent.be by Caddy with `file_server`. The
HTTP VFS datasource reads the database with range requests, so the server must:

- answer range requests with `206` (Caddy does this);
- send a strong `ETag` (Caddy does this);
- not compress the database. Do not add `encode` to the site, or exclude
  `*.sqlite` from it.

The `cache_static` snippet on the server caches `.js` files for one hour. After
a publish, a browser can use the old JavaScript for up to one hour.

When `publish` replaces the database, open browser sessions get an error on
their next read, because the ETag changes. A reload loads the new version.

## Updating Pihka

```sh
just pihka-update          # moves vendor/pihka to the newest Pihka main
just pihka-up              # test
git add vendor/pihka
git commit -m "chore(vendor): update pihka"
```

If Pihka needs a change for BantuLex (a bug fix, a new plugin hook), make it in
the Pihka repository, then update the submodule. Do not commit changes inside
`vendor/pihka`.
