# NordicLaw Manuscripts Database

A searchable catalogue of Icelandic, Norwegian, Danish and Swedish vernacular
law manuscripts and fragments from the Nordic Middle Ages (ca. 1100–1600).

**Live site: <https://nordiclawbooks.github.io/database/>**

The database was created by the
[NordicLaw Project](https://www4.uib.no/en/research/research-projects/nordic-law-books-the-production-and-use-of-vernacular-law-manuscripts-in-the-north-from-1100-to-1600-nordiclaw)
at the University of Bergen, funded by NordForsk
([grant no. 152607](https://www.nordforsk.org/projects/nordic-law-books-production-and-use-vernacular-law-manuscripts-north-1100-1600-nordiclaw)).

## Features

- **Three views** of the same data:
  - *Manuscript View* groups rows by manuscript and keeps the merged cells of
    the source spreadsheet.
  - *Production Unit View* shows one block per production unit.
  - *Text View* is a flat table with one row per text.
- **Full-text search** across all fields, including the expanded names of
  abbreviated texts. Matching ignores case and diacritics, with Nordic-aware
  folding (`æ`, `ø`, `ð`, `þ`, `ǫ` …).
- **Facets** for language, depository, object, material, size, main and minor
  text, dating (year range), script, pricking, ruling, columns, lines, rubric
  and decoration style. Each facet shows how many results it would give.
- **Manuscript details** in a modal, with a locus for each section and a PDF
  download.
- **Collation diagrams** drawn from the Gatherings formula. You can download
  them as PDF, SVG or PNG.
- **Abbreviations are expanded** using the List of Abbreviations, depositories
  and texts tables.
- **Shareable URLs.** The search, filters, view, sort and page are stored in
  the address bar.

## How it works

```
Google Sheets  ──►  Python pipeline  ──►  TSV + JSON in data/  ──►  index.html + js/  ──►  GitHub Pages
(editors)           (data/scripts/)       (committed)               (static app)
```

The editors maintain the data in a Google Sheets spreadsheet with one tab per
language. A Python pipeline exports it to TSV and JSON files that are
committed to [`data/`](data/). The web app is static: plain JavaScript ES
modules, loaded straight by the browser. There is no framework, no bundler and
no build step. GitHub Pages serves the repository root as it is.

## Repository layout

| Path | Contents |
| --- | --- |
| [`index.html`](index.html) | Page shell: Bootstrap layout, toolbar, facet sidebar, views and modals |
| [`js/`](js/) | The application (native ES modules); entry point [`js/main.js`](js/main.js) |
| [`data/`](data/) | Generated data files the site loads (see below) |
| [`data/scripts/`](data/scripts/) | Python pipeline: Google Sheets → `data/` ([README](data/scripts/README.md)) |
| [`tests/`](tests/) | Unit tests for the app's logic (`node --test`) |
| [`img/`](img/) | Banner image |
| [`.github/workflows/`](.github/workflows/) | Tests on every push/PR; deploy to GitHub Pages on push to `main` |

### Data files

Each language has three files in `data/`:

| Language | Grid | Merged cells | Segments |
| --- | --- | --- | --- |
| Danish | `Metadata_Dan_raw.tsv` | `Metadata_Dan_raw_merges.json` | `Metadata_Dan_segments.json` |
| Icelandic | `Metadata_Isl_raw.tsv` | `Metadata_Isl_raw_merges.json` | `Metadata_Isl_segments.json` |
| Norwegian | `Metadata_Norw_raw.tsv` | `Metadata_Norw_raw_merges.json` | `Metadata_Norw_segments.json` |
| Swedish | `Metadata_Swe_raw.tsv` | `Metadata_Swe_raw_merges.json` | `Metadata_Swe_segments.json` |

- **Grid**: the spreadsheet tab as it is, with blank cells kept.
- **Merged cells**: where the sheet merges cells. A manuscript is a run of rows
  under one merged shelf mark.
- **Segments**: each manuscript's sections with computed loci. The details
  modal uses them.

There are also three lookup tables: `abbreviations.tsv`, `texts.tsv` and
`depositories.tsv`. The pipeline exports all of these files from the
spreadsheet. Change the data in the spreadsheet and don't edit these files by
hand.

## Running locally

The app loads its data with `fetch()`, so open it through a web server rather
than as a `file://` URL:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

You don't need to install anything. Bootstrap and jsPDF load from a CDN, and
MiniSearch is vendored in [`js/vendor/`](js/vendor/).

## Tests

```bash
npm test
```

This needs Node 20 or newer and installs nothing. It runs `node --test` over
[`tests/`](tests/). The tests cover the app's pure logic: data loading, field
parsing, abbreviation expansion, facets, search, URL state, collation parsing
and PDF layout. CI runs them on every push and pull request.

## Updating the data

1. Change the data in the Google Sheets spreadsheet.
2. Regenerate the files in `data/` with the pipeline. The
   [scripts README](data/scripts/README.md) covers credentials and options.

   ```bash
   pip install -r requirements.txt
   python data/scripts/pipeline.py sheets --sheet-id <SPREADSHEET_ID> \
     --credentials <service-account.json> --skip-filled --skip-combine
   ```

3. Check the site locally, then commit the changed files in `data/`.

## Deployment

Pushing to `main` runs
[`deploy.yml`](.github/workflows/deploy.yml), which publishes the repository
root to GitHub Pages. Nothing is built: the site is exactly the committed
`index.html`, `js/` and `data/`.

## Credits

- Database design and development: Patrik Granholm (National Library of Sweden)
- Main editor: Stefan Drechsler (University of Bergen)
- Editors: Tonje Waldersnes, Már Jónsson (University of Iceland), Anne Mette
  Hansen (University of Copenhagen), Seán Vrieland (University of Copenhagen),
  Anna Catharina Horn (University of Oslo)

Built with [Bootstrap](https://getbootstrap.com/),
[MiniSearch](https://github.com/lucaong/minisearch) and
[jsPDF](https://github.com/parallax/jsPDF).
