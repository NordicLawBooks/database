# Data pipeline

These scripts export the NordicLaw Google Sheets spreadsheet to the files in
[`data/`](../) that the web app loads. Run them from the repository root.

```
Google Sheets ── convert_sheets_to_tsv.py ──► Metadata_<Lang>_raw.tsv
                                              Metadata_<Lang>_raw_merges.json
                                              abbreviations.tsv, texts.tsv, depositories.tsv
                                                      │
                          extract_segments.py ◄───────┘
                                  │
                                  ▼
                       Metadata_<Lang>_segments.json
```

`<Lang>` is one of `Dan`, `Isl`, `Norw` or `Swe`.

## Setup

You need Python 3.10 or newer.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt   # pandas, google-auth, google-api-python-client
```

The scripts read the spreadsheet through the Google Sheets API as a **service
account**:

1. In a Google Cloud project, enable the Google Sheets API and create a
   service account with a JSON key.
2. Share the spreadsheet with the service account's email address, with
   Viewer access.
3. Pass the key with `--credentials path/to/key.json`, or set
   `GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json`.

Keep the key out of the repository.

## The usual run

```bash
python data/scripts/pipeline.py sheets \
  --sheet-id <SPREADSHEET_ID> \
  --credentials <service-account.json> \
  --skip-filled --skip-combine
```

The spreadsheet ID is the long string in the sheet's URL,
`https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`.

This run rewrites every file the site needs:

- the three lookup tables;
- the grid and merged-cells files for each language;
- the segments file for each language.

Run `git diff --stat data/` to see what changed. Check the site locally
(`python3 -m http.server 8000`), then commit.

Add `--dry-run` to print the commands without running them.

## `pipeline.py`

`pipeline.py` runs the other scripts.

| Command | What it does |
| --- | --- |
| `sheets` | Exports everything from Google Sheets. It runs these stages in order: lookups → filled → raw → segments → combine. |
| `segments` | Rebuilds `*_segments.json` from the `*_raw.tsv` and `*_raw_merges.json` already in `data/`. It doesn't need a network connection or credentials. |
| `combine` | Joins the four filled TSVs into `data/NordicLaw_data.tsv`. |

Options for `sheets`:

| Flag | Meaning |
| --- | --- |
| `--sheet-id` | Spreadsheet ID (required) |
| `--credentials` | Service-account JSON key; otherwise `GOOGLE_APPLICATION_CREDENTIALS` is used |
| `--skip-lookups` | Keep the current `abbreviations.tsv`, `texts.tsv` and `depositories.tsv` |
| `--skip-raw` | Don't regenerate `*_raw.tsv` and `*_raw_merges.json` |
| `--skip-segments` | Don't regenerate `*_segments.json` |
| `--skip-filled` | Don't write the filled `Metadata_<Lang>.tsv` files. The site doesn't use them, so always pass this. |
| `--skip-combine` | Don't write `NordicLaw_data.tsv`. The site doesn't use it, so always pass this. |
| `--dry-run` | Print the commands without running them |

The filled TSVs and `NordicLaw_data.tsv` are left over from an older version
of the site. The browser now fills merged cells down itself.

## Stage scripts

You can also run each stage on its own.

### `convert_sheets_to_tsv.py`

Fetches the language tabs (`Danish`, `Icelandic`, `Norwegian`, `Swedish`)
through the Sheets API. The first 6 rows of each tab are header rows and are
skipped.

```bash
# Raw grid + merge geometry for all languages (what the site uses)
python data/scripts/convert_sheets_to_tsv.py --sheet-id <ID> --credentials key.json \
  --all-sheets --raw --export-merges

# One language only
python data/scripts/convert_sheets_to_tsv.py --sheet-id <ID> --credentials key.json \
  --sheet-name Swedish --raw --export-merges

# Lookup tabs (Abbreviations, Texts, Depositories)
python data/scripts/convert_sheets_to_tsv.py --sheet-id <ID> --credentials key.json --lookups
```

- **`--raw`** writes the grid as it is, keeping blank cells, together with
  `*_raw_merges.json`. That file lists every merged range (`minRow`/`maxRow`,
  `minCol`/`maxCol`) and its value. Row indices are 0-based and count from the
  first data row, after the TSV header.
- **Without `--raw`** (filled mode), the script fills merged cells down,
  normalizes text, merges `Links to Database` per manuscript and removes
  duplicate rows. It writes the result to `Metadata_<Lang>.tsv`. The site
  doesn't use these files.
- `--out-dir` changes the output directory. The default is `data/`.

### `extract_segments.py`

Turns `*_raw.tsv` and `*_raw_merges.json` into `*_segments.json`, which the
manuscript details modal uses.

```bash
python data/scripts/extract_segments.py \
  --raw-tsv data/Metadata_Dan_raw.tsv \
  --merges-json data/Metadata_Dan_raw_merges.json \
  --out data/Metadata_Dan_segments.json
```

- A **manuscript** is a run of consecutive rows with the same `Shelf mark`,
  filled down from the merged cell.
- For each segment column (`Main text`, `Script`, `Dating`, …), each merged
  range in that column becomes one **segment**. So does each non-empty cell
  that isn't part of a merge.
- Each segment gets a **locus** (for example `ff. 1r-23r`), computed from the
  `Leaves/Pages` values of the rows it covers.
- `--segment-columns` overrides the list of columns that produce segments.

The output has this shape:

```jsonc
{
  "source": { "rawTsv": "…", "mergesJson": "…", "sheet": "Danish" },
  "segmentColumns": ["Name", "Object", …],
  "manuscripts": [
    {
      "Shelfmark": "AM 286 fol.",
      "Depository": "AMS",
      "rowRangeAbs": { "start": 0, "end": 1 },
      "rowCount": 2,
      "segmentsByColumn": {
        "Script": [
          { "column": "Script", "label": "…", "startRow": 0, "endRow": 1,
            "startRowAbs": 0, "endRowAbs": 1, "source": "merge",
            "locus": { "kind": "f", "from": "1r", "to": "23r", "rendered": "ff. 1r-23r", … } }
        ]
      }
    }
  ]
}
```

### `combine_tsv_files.py`

Joins the four filled `Metadata_<Lang>.tsv` files into `data/NordicLaw_data.tsv`
and adds a `Language` column. The site doesn't use the output.

## Notes

- **Edit the spreadsheet, not the files in `data/`.** The next export
  overwrites any change made by hand.
- **Abbreviations in the data must match the lookup tabs exactly**, including
  case and accents; only Réttarbót codes ignore case. An abbreviation with no
  match, or whose lookup row has no expansion, is shown on the site as written,
  without any warning.
- Make each language's three files (grid, merged cells, segments) in the same
  run. The merged-cells file refers to rows by position, so a grid from one
  export doesn't match a merged-cells file from another.
