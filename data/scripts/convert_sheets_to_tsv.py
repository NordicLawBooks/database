"""Convert NordicLaw Google Sheets tabs to TSV + merges JSON.

Replaces convert_excel_to_tsv.py for a Sheets-first workflow.
One spreadsheet, four language tabs (Danish / Icelandic / Norwegian / Swedish).
All post-processing (fill, hyperlinks, link-merge, dedup, normalize) is
identical to the Excel version; only the data-loading layer changes.

Auth
----
Expects a service-account JSON key file.  Pass it via --credentials or the
GOOGLE_APPLICATION_CREDENTIALS env var.  The service account needs at least
Viewer access to the spreadsheet.

Usage
-----
  # One language:
  python data/scripts/convert_sheets_to_tsv.py \
    --sheet-id  1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms \
    --sheet-name Swedish \
    --credentials path/to/service_account.json

  # All four languages:
  python data/scripts/convert_sheets_to_tsv.py \
    --sheet-id  1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms \
    --all-sheets \
    --credentials path/to/service_account.json \
    --raw --export-merges
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from pathlib import Path

import pandas as pd
from google.oauth2 import service_account
from googleapiclient.discovery import build

# ---------------------------------------------------------------------------
# CONFIG  (mirrors convert_excel_to_tsv.py)
# ---------------------------------------------------------------------------

HEADER_ROWS_IN_SHEET = 6   # rows to skip before data starts (0-based: rows 0-5)

# Maps Google Sheets tab name → (ISO language code, output filename stem)
SHEET_LANGUAGE_MAP: dict[str, tuple[str, str]] = {
    "Danish":    ("da", "Metadata_Dan"),
    "Icelandic": ("is", "Metadata_Isl"),
    "Norwegian": ("no", "Metadata_Norw"),
    "Swedish":   ("sv", "Metadata_Swe"),
}

DEDUPLICATE_ROWS   = True
MERGE_LINKS        = True
FILL_MERGED_CELLS  = True
EXTRACT_HYPERLINKS = True
NORMALIZE_TEXT     = True
CLEAN_UNAVAILABLE  = True
DROP_EMPTY_ROWS    = True

TARGET_HEADERS = [
    "Shelf mark","Name","Related Shelfmarks","Depository","Object","Size","Dating",
    "Leaves/Pages","Main text","Minor text","Gatherings","Full size","Leaf size",
    "Catch Words and Gatherings","Production Unit","Pricking","Material","Ruling",
    "Columns","Lines","Script","Rubric","Scribe","Production","Style","Colours",
    "Form of Initials","Size of Initials","Iconography","Place","Literature","Links to Database"
]

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

# ---------------------------------------------------------------------------
# Google Sheets helpers
# ---------------------------------------------------------------------------

def build_service(credentials_path: str | None):
    if credentials_path:
        creds = service_account.Credentials.from_service_account_file(
            credentials_path, scopes=SCOPES
        )
    else:
        # Falls back to GOOGLE_APPLICATION_CREDENTIALS env var via ADC.
        import google.auth
        creds, _ = google.auth.default(scopes=SCOPES)
    return build("sheets", "v4", credentials=creds)


def fetch_sheet(service, sheet_id: str, sheet_name: str) -> dict:
    """Return the full sheet object with grid data and merge ranges."""
    result = (
        service.spreadsheets()
        .get(spreadsheetId=sheet_id, includeGridData=True)
        .execute()
    )
    for sheet in result.get("sheets", []):
        if sheet["properties"]["title"] == sheet_name:
            return sheet
    raise ValueError(f"Sheet '{sheet_name}' not found in spreadsheet {sheet_id}")


def cell_str(cell: dict) -> str:
    """Return the display string for a Sheets API cell object."""
    ev = cell.get("effectiveValue", {})
    if "stringValue" in ev:
        return ev["stringValue"]
    if "numberValue" in ev:
        # Prefer formatted string when available (preserves e.g. date formatting).
        fmt = cell.get("formattedValue")
        return fmt if fmt is not None else str(ev["numberValue"])
    if "boolValue" in ev:
        return str(ev["boolValue"])
    return cell.get("formattedValue", "")


def cell_hyperlink(cell: dict) -> tuple[str, str] | tuple[None, None]:
    """Return (display_text, url) if the cell has a hyperlink, else (None, None)."""
    url = cell.get("hyperlink")
    if url:
        text = cell_str(cell)
        return text or url, url
    return None, None


def sheet_to_dataframe(sheet: dict) -> tuple[pd.DataFrame, list[dict]]:
    """
    Build a DataFrame from sheet grid data, skipping header rows.
    Also returns raw merge ranges as a list of dicts (Sheets API GridRange format,
    0-based inclusive-start / exclusive-end).
    """
    row_data = sheet.get("data", [{}])[0].get("rowData", [])
    data_rows = row_data[HEADER_ROWS_IN_SHEET:]

    n_cols = len(TARGET_HEADERS)
    records: list[list[str]] = []
    hyperlinks: list[tuple[int, int, str, str]] = []  # (row_idx, col_idx, text, url)

    for ri, row in enumerate(data_rows):
        cells = row.get("values", [])
        row_vals: list[str] = []
        for ci in range(n_cols):
            cell = cells[ci] if ci < len(cells) else {}
            row_vals.append(cell_str(cell))
            if ci == n_cols - 1 or TARGET_HEADERS[ci] == "Links to Database":
                # Capture hyperlinks for "Links to Database" column.
                links_ci = TARGET_HEADERS.index("Links to Database")
                if ci == links_ci:
                    text, url = cell_hyperlink(cell)
                    if text and url:
                        hyperlinks.append((ri, ci, text, url))
        records.append(row_vals)

    df = pd.DataFrame(records, columns=TARGET_HEADERS[:n_cols])

    # Re-apply hyperlinks as Markdown (collected above).
    for ri, ci, text, url in hyperlinks:
        df.iat[ri, ci] = f"[{text}]({url})"

    merges = sheet.get("merges", [])
    return df, merges


def merges_to_json(merges: list[dict], df: pd.DataFrame, sheet_id: str, sheet_name: str) -> dict:
    """
    Convert Sheets API merge ranges to the same JSON format produced by
    convert_excel_to_tsv.py --export-merges.

    Sheets API uses 0-based, exclusive-end indexing.
    We translate to 0-based, inclusive-end df row indices (same as the Excel version).
    """
    n_cols = len(df.columns)
    out: list[dict] = []

    for m in merges:
        # Translate row indices: subtract HEADER_ROWS_IN_SHEET, convert to inclusive end.
        sr = m.get("startRowIndex", 0) - HEADER_ROWS_IN_SHEET
        er = m.get("endRowIndex", 0) - HEADER_ROWS_IN_SHEET - 1
        sc = m.get("startColumnIndex", 0)
        ec = m.get("endColumnIndex", 0) - 1

        # Skip merges entirely in the header or outside column range.
        if er < 0 or sr >= len(df) or ec < 0 or sc >= n_cols:
            continue
        sr = max(sr, 0)
        er = min(er, len(df) - 1)
        ec = min(ec, n_cols - 1)

        # Only single-column merges (rowspan) are meaningful for the segment model.
        if sc != ec:
            continue

        value = df.iat[sr, sc] if sr < len(df) else ""
        out.append({
            "minRow": int(sr),
            "maxRow": int(er),
            "minColIndex": int(sc),
            "maxColIndex": int(ec),
            "minCol": str(df.columns[sc]),
            "maxCol": str(df.columns[ec]),
            "value": str(value) if value else "",
        })

    return {
        "source": f"https://docs.google.com/spreadsheets/d/{sheet_id}",
        "sheet": sheet_name,
        "headerRowsSkipped": HEADER_ROWS_IN_SHEET,
        "columns": list(map(str, df.columns)),
        "rowCount": int(len(df)),
        "merges": out,
    }

# ---------------------------------------------------------------------------
# Post-processing  (unchanged from convert_excel_to_tsv.py)
# ---------------------------------------------------------------------------

def fill_merged_cells(df: pd.DataFrame, merges: list[dict]) -> pd.DataFrame:
    for m in merges:
        sr = m.get("startRowIndex", 0) - HEADER_ROWS_IN_SHEET
        er = m.get("endRowIndex", 0) - HEADER_ROWS_IN_SHEET - 1
        sc = m.get("startColumnIndex", 0)
        ec = m.get("endColumnIndex", 0) - 1
        if er < sr or sc != ec or sc >= len(df.columns):
            continue
        sr = max(sr, 0)
        er = min(er, len(df) - 1)
        top_val = df.iat[sr, sc]
        for ri in range(sr + 1, er + 1):
            if ri < len(df) and (not df.iat[ri, sc] or pd.isna(df.iat[ri, sc])):
                df.iat[ri, sc] = top_val
    return df


def normalize_text(v) -> str:
    if v is None or pd.isna(v):
        return ""
    s = str(v)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"(?<=\S)\n(?=\S)", "; ", s)
    s = re.sub(r"(^\n|\n$)", "", s)
    return s.strip()


def normalize_newlines_to_space(v) -> str:
    if v is None or pd.isna(v):
        return ""
    s = str(v)
    s = re.sub(r"[\r\n\u2028\u2029\x85\x0b\x0c]+", " ", s)
    s = re.sub(r" {2,}", " ", s)
    return s.strip()


_MD_LABEL_RE = re.compile(r"^\[([^\]]+)\]\(([^)]+)\)$")


def merge_links(df: pd.DataFrame) -> pd.DataFrame:
    def _is_blank(v) -> bool:
        return v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == ""

    def _join_unique(series: pd.Series) -> str:
        labels_with_urls: set[str] = set()
        for v in series:
            if _is_blank(v):
                continue
            m = _MD_LABEL_RE.match(str(v).strip())
            if m:
                labels_with_urls.add(m.group(1))
        seen, out = set(), []
        for v in series:
            if _is_blank(v):
                continue
            s = str(v).strip()
            if s in labels_with_urls:
                continue
            if s not in seen:
                seen.add(s)
                out.append(s)
        return "; ".join(out)

    group_cols = ["Depository", "Shelf mark"] if "Depository" in df.columns else ["Shelf mark"]
    merged = df.groupby(group_cols, sort=False)["Links to Database"].apply(_join_unique)
    df["Links to Database"] = df.set_index(group_cols).index.map(merged).fillna("")
    return df

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def process_one_sheet(
    service,
    sheet_id: str,
    sheet_name: str,
    out_dir: Path,
    raw: bool,
    export_merges: bool,
) -> None:
    _, stem = SHEET_LANGUAGE_MAP[sheet_name]
    suffix = "_raw" if raw else ""
    out_tsv = out_dir / f"{stem}{suffix}.tsv"
    out_merges = out_dir / f"{stem}{suffix}_merges.json"

    print(f"Fetching '{sheet_name}' …")
    sheet = fetch_sheet(service, sheet_id, sheet_name)
    df, raw_merges = sheet_to_dataframe(sheet)
    print(f"  {len(df)} data rows, {len(raw_merges)} merge ranges")

    if raw or export_merges:
        payload = merges_to_json(raw_merges, df, sheet_id, sheet_name)
        with open(out_merges, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"  Wrote {out_merges}")

    if raw:
        df = df.apply(lambda col: col.map(normalize_newlines_to_space))
    else:
        if FILL_MERGED_CELLS:
            df = fill_merged_cells(df, raw_merges)
        if CLEAN_UNAVAILABLE:
            df.replace("Unavailable", "", inplace=True)
        if NORMALIZE_TEXT:
            df = df.apply(lambda col: col.map(normalize_text))
        if DROP_EMPTY_ROWS:
            empty = df.apply(lambda c: c.fillna("").astype(str).str.strip().eq(""))
            df = df.loc[~empty.all(axis=1)].reset_index(drop=True)
        if MERGE_LINKS and "Links to Database" in df.columns:
            df = merge_links(df)
        if DEDUPLICATE_ROWS:
            before = len(df)
            df = df.drop_duplicates(keep="first").reset_index(drop=True)
            if len(df) < before:
                print(f"  Dropped {before - len(df)} duplicate rows")

    buf = io.StringIO()
    df.to_csv(buf, sep="\t", index=False, quoting=csv.QUOTE_MINIMAL, quotechar="\x00", lineterminator="\n")
    with open(out_tsv, "w", encoding="utf-8", newline="") as f:
        f.write(buf.getvalue())
    print(f"  Wrote {out_tsv}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--sheet-id", required=True, help="Google Sheets spreadsheet ID (from the URL)")
    parser.add_argument(
        "--sheet-name",
        choices=list(SHEET_LANGUAGE_MAP),
        help="Single sheet tab to process. Omit to use --all-sheets.",
    )
    parser.add_argument("--all-sheets", action="store_true", help="Process all four language tabs.")
    parser.add_argument(
        "--out-dir", default="data",
        help="Directory for output TSV/JSON files (default: data/).",
    )
    parser.add_argument("--credentials", default=None, help="Path to service account JSON key (or set GOOGLE_APPLICATION_CREDENTIALS)")
    parser.add_argument("--raw", action="store_true", help="Raw mode: no fill/normalize/dedup; always exports merges JSON")
    parser.add_argument("--export-merges", action="store_true", help="Write *_merges.json sidecar alongside the TSV")
    args = parser.parse_args(argv)

    if not args.sheet_name and not args.all_sheets:
        parser.error("Specify --sheet-name <name> or --all-sheets")

    sheet_names = list(SHEET_LANGUAGE_MAP) if args.all_sheets else [args.sheet_name]
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    service = build_service(args.credentials)
    for name in sheet_names:
        process_one_sheet(
            service,
            args.sheet_id,
            name,
            out_dir,
            raw=args.raw,
            export_merges=args.export_merges,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
