# Publishing with Pihka

The public BantuLex website is a [Pihka](https://github.com/GhentCDH/Pihka) site:
static files and one SQLite database, which the browser queries itself. There is
no backend on the server, only Caddy as a file server.

```
data/*.xlsx --importer--> Postgres --Dataflow--> SQLite export
    --just site-db--> site/database/bantulex.sqlite (with search indexes and views)
    --just build-site--> dist/bantulex/ --just publish--> web server
```

## Layout

| Path | Contents |
| --- | --- |
| `vendor/pihka/` | Git submodule of GhentCDH/Pihka, pinned to one commit. Never edit it here. |
| `site/` | Everything specific to BantuLex. It becomes Pihka's `app/` folder. |
| `site/config.json` | Database, datasource, perspectives, table options and plugins. |
| `site/menu.json`, `site/footer.json`, `site/pages/` | Menu, footer and the about pages (en, nl). |
| `site/extensions/` | Optional BantuLex-specific Pihka plugins, referenced as `app/extensions/...` in `config.json`. |
| `site/database/` | The prepared database. Gitignored. |
| `dist/` | The built site. Gitignored. |

Pihka's own documentation explains the configuration keys and the plugin API:
see `vendor/pihka/README.md` and `vendor/pihka/ARCHITECTURE.md`.

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
   adds the full-text search indexes and the perspective views. This is
   necessary because the HTTP VFS datasource reads the database without changing
   it. Run it again after you change `perspectives` or the search settings in
   `site/config.json`. Use `BANTULEX_SOURCE_DB=<path>` for a different export.
   Needs Node.js 22.13 or newer.
3. **`just pihka-up`** serves the site on http://localhost:9161. `site/` is
   mounted live: reload the browser after a change.
4. **`just publish`** builds `dist/bantulex` (Pihka plus `site/` as `app/`,
   without the Pihka demo) and copies it with rsync. Set the target first:
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
