# Data quality and open questions

Known issues in the data, found in the SQLite export of 2026-10-12. Most of
them must be fixed in the spreadsheets, not in code.

## Known issues

### Reflexes with a `blr_index` but no reconstruction

3,269 reflexes have a `blr_index` but no `blr_entry_id`. Only 9 of these are
numbers without a matching BLR entry. The others are labels that are not BLR
numbers, for example `PT` (166 rows), `banana_64`, `banana_09` and `1939 1935`.
Find out what these labels mean; if they are a separate index, they need their
own column.

### Reliability values are free text

`blrreliability` has 29 values for what is one score: `1`, `1a`, `1A`, `1(a)`,
`1/3`, `1/3a`, `1 ou 3`, and more. As a filter this gives many near-duplicate
options. A fixed list of values in the BLR workbook would fix this.

### One language, several `variety` rows

A `variety` row is a name plus a classification. 231 English names occur in
more than one row (700 rows in total). For example, "Wanzi" has three rows with
different Guthrie and Bastin codes. Filtering or grouping on `name_english`
merges these rows; filtering on `id` splits one language.

### Project names with variants

`project` has spelling variants of one project: `BantuFirst` and `BantUFirst`,
and `KongoKing`, `KongoKing  Gent` (two spaces) and `KongoKing Verviers`.

### Two coordinates per location

130 locations have a `default` and an `original` coordinate. A query that joins
`reflex` to all coordinates returns those reflexes twice. Join on
`coordinate.description = 'default'` to get one point per location.

### Outdated documentation

`ARCHITECTURE.md`, `AGENTS.md`/`CLAUDE.md` and `README.md` still describe the
Kottster admin and `data/bantulex.db` as the main database. The importer writes
to Postgres. The `feat/crouton` branch updates these files.

## Open questions

- **`reconstruction.proto_kk`** (Excel `Proto KK`) is empty for all rows. What
  is it meant for? Possibly a Proto-Kikongo form.
- **`blrconsonantstructure.cs`** (Excel `CS`) has values such as `ps 10`, `907`
  and `2011`. What does it encode?
- **`reflex.term_morph_analysis`**: which conventions does it use (`+` for a
  root, `-` for an affix boundary)?
- **`variety.substrate_suspect`**: who decides this, and on what basis?
