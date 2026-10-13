# BantuLex EvoLex

An etymological dictionary of Bantu, modelled on
[EvoLex](https://evolex.huma-num.fr/) and [EvoSem](https://evosem.huma-num.fr/).
It runs entirely in the browser: Pihka's data engine reads the published SQLite
database over HTTP range requests, so there is no backend.

Served at `app/evolex/` next to the Pihka data browser (menu: *Etymological
dictionary*). Local preview: `just site-db && just pihka-up`, then
http://localhost:9161/app/evolex/.

## Pages

| Route | EvoLex/EvoSem equivalent | Contents |
| --- | --- | --- |
| `#/` | `home_<family>.html` | Introduction, statistics, map of all varieties, most widely attested roots, data gaps |
| `#/etyma` | `index_etyma.html` | All BLR reconstructions; search (word, tone, English, French) and facets (reflexes, reliability, noun class, Guthrie zone) |
| `#/entry/<blr>` | `lex_entry.html?etym=` | Reconstruction with C/V/T structure; reflex map and table, filtered by branch, part of speech and semantic field |
| `#/etymograph/<blr>` | `etymograph.html` | Senses of the root's reflexes as a graph; edge weight = number of roots sharing the sense pair (θ slider) |
| `#/sources` | `sources.html` | Sources with reflex and root counts |

Filters live in the URL, so every view can be linked.

## Code

No build step: Preact with `h()` and Pico CSS, as in Pihka.

| Path | Contents |
| --- | --- |
| `index.html` | Import map for Pihka's vendored Preact; Pico, Pihka `base.css`, MapLibre CSS |
| `main.js` | Router and page switch |
| `data/db.js` | One Pihka dataset (`openDataset` + `HttpDataSource`); `table()` and `facets()` use Pihka's DataStore, `sql()` runs other queries. Adds three filter types: `fts` (an FTS5 index of another table), `contains` and `zone` |
| `components/router.js` | Hash routes `#/<page>/<id>?<params>` |
| `components/ui.js` | Layout, facet panel (Pihka `DropdownFacet`), table, Pihka `Pagination` |
| `components/map.js` | MapLibre map on Pihka's `point_map` setup: vendored MapLibre, local `world.pmtiles` (zoom ≤ 4, no external services), one circle layer |
| `components/force-graph.js` | Small force-directed SVG graph (no d3) |
| `pages/` | One module per page |
| `config.json` | FTS settings for the EvoLex tables, merged into `site/config.json` by `just site-db` |

## Data

`just site-db` copies `data/bantulex.db`, then
`utils/exporter/src/exporter/export_evolex_site.py` (`uv run evolex-site`) adds
precomputed, indexed tables. Over HTTP VFS, every page read is a request, so
joins and aggregates are done once at build time:

| Table | Contents |
| --- | --- |
| `evolex_etyma` | Reconstructions with reliability, contributor and reflex/variety counts (FTS index on word, tone, English, French) |
| `evolex_etyma_zone` | Reconstruction × Guthrie zone, from `distribution` |
| `evolex_reflex` | Linked reflexes with variety, branch, default coordinate and first primary source |
| `evolex_variety` | Varieties with one point (average of their default coordinates) |
| `evolex_source` | Sources with reflex and root counts |
| `evolex_sense` | Root × sense: the reflex `meaning`, lowercased and split on `;` `,` `/`, without part-of-speech markers |
| `evolex_sense_pair` | Sense pairs that occur in two or more roots, with the number of roots |

The database is written with 1 KiB pages, as recommended for HTTP VFS.

## Not yet in the data

Compared to EvoLex and EvoSem, the BantuLex database lacks:

- **Concepts.** Reflex meanings are free text. EvoSem maps glosses to concepts (`ES_Gloss`); here senses are normalised strings, so the etymograph is an approximation (e.g. 'leg' and 'legs' are different senses).
- **Language identifiers.** No Glottocode or ISO 639-3 per variety (EvoLex `Glottocode`, `Isocode`).
- **Classification.** Only the Guthrie code and a flat `branch`; `branch_detailed` is a path for West-Coastal Bantu only. No proto-language levels for intermediate reconstructions (EvoLex `Family`, `Subgroup`, `Language_Cluster`).
- **Morphology.** `term_morph_analysis` is free-form and filled for 39% of reflexes (EvoLex `Morph`).
- **Cognacy.** One BLR root per reflex; no certainty, partial cognacy or loan flag.
- **Entry notes and illustrations.** Root notes are rare (3%); no pictures (EvoLex `Public_note`, `Picture_URL`).
- **Bibliography.** No formatted full reference, URL or PDF page per source (EvoLex `{family}_sources.json`, `Page_File`).
- **Sound correspondences.** BLR gives the C/V/T structure of roots, but there are no correspondence sets per language.
- **Coordinates.** Only 6 of 399 Eastern Bantu varieties have a coordinate, and some points are wrong (latitude and longitude swapped for Ndengese C81 and Liko D201; a missing minus sign for Kaonde L41).

BantuLex has what EvoLex lacks: the consonant/vowel/tone structure of roots,
reliability, noun classes, fieldwork provenance and source roles.
