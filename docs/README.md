# BantuLex documentation

- [Data model](data-model.md): what each table and column means, and where it
  comes from in the spreadsheets.
- [Data quality](data-quality.md): known issues in the data and open questions.
- [Publishing](publishing.md): how the public website is built with Pihka and
  deployed.

## Data flow

```
data/bantulex.xlsx, data/BLR_export.xlsx
        │  just import (utils/importer)
        ▼
  data/bantulex.db ──── exporters (utils/exporter) ──► EvoLex Excel, to-fix worklist
        │      ▲
        │      └── edits: admin (Crouton, /admin/)
        ▼
  bantulex.ugent.be (Pihka): the browser downloads the same file
```
