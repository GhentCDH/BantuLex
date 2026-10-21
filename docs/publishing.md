# Publishing with Pihka

The public BantuLex website is a static site built on the
[Pihka](https://github.com/GhentCDH/Pihka) engine: static files and one SQLite
database, which the browser queries itself. There is no backend on the server,
only Caddy as a file server. The UI is BantuLex's own (`site/`); it does not use
Pihka's default UI. From Pihka it uses only the query engine (`core/engine`), the
vendored Preact and SQLite WASM (`core/vendor`) and the map extension
(`extensions/point_map`).

```
data/*.xlsx --just import--> data/bantulex.db <--edits-- admin (Crouton)
                                    |
                                    +--served as /database/bantulex.db--> browser (Pihka)

site/ + Pihka --just build-site--> dist/bantulex/ --just publish--> web server
```

The site and the admin use the same database file. An edit in the admin is
visible on the site after the next page load; there is no export or publish
step for data. The database is not in `dist/`: Caddy serves
`data/bantulex.db` at `/database/bantulex.db`, and nothing else from `data/`.

## Layout

| Path | Contents |
| --- | --- |
| `vendor/pihka/` | Git submodule of GhentCDH/Pihka, pinned to one commit. Never edit it here. |
| `site/` | The BantuLex site. It is the web root; `build-site` adds Pihka's `core/` and `extensions/point_map/` beside it. |
| `site/config.json` | Database URL, perspectives (`reflex_search` and `blr_reconstruction` are materialized with indexes), the engine plugin and the sound structure inventories. |
| `site/main.js` | Composition root: opens the database with the Pihka engine and mounts the UI. |
| `site/engine/filters.js` | Engine plugin with the BantuLex filter types (`values`, `contains`, `gloss`, `blr-structure`). All SQL lives here. |
| `site/ui/` | Preact UI: views (`search`, `blr`, `reflex`), components (meaning search, sound structure, column filter, results, map), URL state and translations (en, nl). |
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

1. **`just import`** fills `data/bantulex.db`; after that, the admin edits it.
2. **`just pihka-up`** serves the site on http://localhost:9161. `site/`, the
   Pihka submodule and `data/` are mounted live: reload the browser after a
   change.
3. **`just publish`** builds `dist/bantulex` (`site/` plus Pihka's `core/` and
   `extensions/point_map/`) and copies it with rsync. Set the target first:
   `BANTULEX_DEPLOY_TARGET=<host>:/var/www/bantulex/`. Only code changes need a
   publish; data changes do not.

## Database loading

The browser downloads the whole database (about 9 MB with zstd) and opens it in
memory. `data/bantulex.db` has no `reflex_search` or `blr_reconstruction`
tables: they are perspectives with `"materialize": true`, and the Pihka engine
builds them with their indexes on every page load (about 0.6 s for 185,000
reflexes). The site does not use full-text search
(`"enrichment": {"fts": false}`), so no search indexes are built.

Do not run Pihka's `prepareSampleDatabase` on `data/bantulex.db`. It writes
these tables into the file, and the admin does not update them. If the file has
them anyway, `site/main.js` drops them from the in-memory copy (with a console
warning), and the engine builds them again from the current data.

## Caching

Caddy sends `Cache-Control: no-cache` for the database, HTML, JavaScript, CSS
and JSON. The browser keeps its copy and revalidates it with the `ETag` (from
the file's modification time and size) on every load: an unchanged database
costs one `304` response, a changed one is downloaded again. There is no
version number to raise after an edit.

The admin writes with a rollback journal. A download that runs during a write
can get a mix of old and new pages; the site can then fail to open the
database or show inconsistent rows, and a reload fixes it. This is rare, because most writes change a few pages in
a few milliseconds, but a bulk import takes about a second.

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
