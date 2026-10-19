import pandas as pd
from openpyxl import load_workbook
import sys
import os
import re
import csv
import io
import argparse
import json

# ---------------------------------------------
# CONFIG
# ---------------------------------------------

HEADER_ROWS_IN_EXCEL = 6  # number of header rows to skip in Ark1

# Drop duplicate rows before writing TSV.
# Duplicates are detected across ALL columns.
DEDUPLICATE_ROWS = True

# Merge all values in "Links to Database" per (Depository, Shelf mark).
MERGE_LINKS = True

# Fill down values across merged Excel cells.
FILL_MERGED_CELLS = True

# Extract hyperlinks in "Links to Database" as Markdown links.
EXTRACT_HYPERLINKS = True

# Normalize whitespace/newlines in cell values.
NORMALIZE_TEXT = True

# Replace literal "Unavailable" with empty string.
CLEAN_UNAVAILABLE = True

# Drop rows where all cells are blank.
DROP_EMPTY_ROWS = True

TARGET_HEADERS = [
    "Shelf mark","Name","Related Shelfmarks","Depository","Object","Size","Dating",
    "Leaves/Pages","Main text","Minor text","Gatherings","Full size","Leaf size",
    "Catch Words and Gatherings","Production Unit","Pricking","Material","Ruling",
    "Columns","Lines","Script","Rubric","Scribe","Production","Style","Colours",
    "Form of Initials","Size of Initials","Iconography","Place","Literature","Links to Database"
]

# ------------ helpers ------------ #

def dataframe_row(excel_row):
    return excel_row - (HEADER_ROWS_IN_EXCEL + 1)  # convert Excel row -> df index


def fill_column_from_merges(df, ws, column_name):
    col_idx = df.columns.get_loc(column_name) + 1
    values = df[column_name].tolist()

    for merged_range in ws.merged_cells.ranges:
        if merged_range.min_col <= col_idx <= merged_range.max_col:
            top_value = ws.cell(merged_range.min_row, col_idx).value
            for row in range(merged_range.min_row, merged_range.max_row + 1):
                di = dataframe_row(row)
                if 0 <= di < len(values):
                    if not values[di] or pd.isna(values[di]):
                        values[di] = top_value

    df[column_name] = values


_HYPERLINK_FORMULA_RE = re.compile(
    r'^\s*=?\s*HYPER(?:LÄNK|LINK)\(\s*"([^"]+)"\s*[,;]\s*"([^"]+)"\s*\)\s*$',
    re.IGNORECASE,
)


def extract_hyperlink(cell):
    # Prefer explicit hyperlink objects.
    if getattr(cell, "hyperlink", None):
        return cell.value, cell.hyperlink.target

    # Fall back to parsing formulas like:
    #   =HYPERLINK("url","text")
    #   =HYPERLÄNK("url";"text")
    # Note: locale-dependent argument separator can be ',' or ';'.
    if isinstance(cell.value, str):
        m = _HYPERLINK_FORMULA_RE.match(cell.value)
        if m:
            url = m.group(1)
            text = m.group(2)
            return text, url

    return None, None


# ------------ main ------------ #

parser = argparse.ArgumentParser(
    description="Convert NordicLaw Excel (Ark1) to TSV, filling merged cells and normalizing links."
)
parser.add_argument("excel_file_path", help="Path to the Excel file")
parser.add_argument(
    "--no-dedup",
    dest="dedup",
    action="store_false",
    help="Do not drop duplicate output rows",
)
parser.add_argument(
    "--no-link-merge",
    dest="link_merge",
    action="store_false",
    help="Do not merge 'Links to Database' within (Depository, Shelf mark)",
)
parser.add_argument(
    "--no-ffilling",
    dest="ffill",
    action="store_false",
    help="Do not fill values down across merged Excel cells (preserves blanks like in Excel)",
)
parser.add_argument(
    "--excel-identical",
    dest="excel_identical",
    action="store_true",
    help=(
        "Disable all transformations (no ffill, no hyperlink extraction, no link merge, "
        "no normalization, no dedup, no 'Unavailable' cleanup) to match Excel as closely as possible"
    ),
)
parser.add_argument(
    "--keep-empty-rows",
    dest="drop_empty_rows",
    action="store_false",
    help="Keep completely empty rows (all columns blank)",
)
parser.add_argument(
    "--export-merges",
    dest="export_merges",
    action="store_true",
    help="Export Excel merged-cell ranges from Ark1 as a JSON sidecar for exact rowspan/colspan rendering",
)
parser.set_defaults(
    dedup=DEDUPLICATE_ROWS,
    link_merge=MERGE_LINKS,
    ffill=FILL_MERGED_CELLS,
    excel_identical=False,
    drop_empty_rows=DROP_EMPTY_ROWS,
    export_merges=False,
)

args = parser.parse_args()

# Convenience mode: try to keep TSV identical to visible Excel.
if args.excel_identical:
    args.dedup = False
    args.link_merge = False
    args.ffill = False
    args.drop_empty_rows = False
    # TSV cannot preserve Excel hyperlink objects; exporting them as Markdown is the
    # closest "Excel-identical" representation we can provide.
    extract_hyperlinks = EXTRACT_HYPERLINKS
    # Keep text as-is except for one critical cleanup: Excel line breaks inside cells.
    # In the raw TSV, replace any embedded newlines with a single space.
    normalize_text_enabled = False
    normalize_newlines_only = True
    clean_unavailable_enabled = False
else:
    extract_hyperlinks = EXTRACT_HYPERLINKS
    normalize_text_enabled = NORMALIZE_TEXT
    normalize_newlines_only = False
    clean_unavailable_enabled = CLEAN_UNAVAILABLE

excel_file_path = args.excel_file_path
base_path = os.path.splitext(excel_file_path)[0]
# Output naming:
# - raw (excel-identical): keep a distinct *_raw.tsv
# - filled/default: write directly to *.tsv (no _ffill suffix)
tsv_file_path = base_path + ("_raw.tsv" if args.excel_identical else ".tsv")
# Merge sidecar follows the same convention.
merges_json_path = base_path + ("_raw_merges.json" if args.excel_identical else "_merges.json")

# --- load raw Excel ---

df_raw = pd.read_excel(
    excel_file_path,
    dtype=str,
    sheet_name="Ark1",
    header=None,            # <-- important: do NOT treat any rows as header
    keep_default_na=False
)

# drop the multirow header section
df = df_raw.iloc[HEADER_ROWS_IN_EXCEL:, :].reset_index(drop=True)

# assign clean target headers
df.columns = TARGET_HEADERS[:df.shape[1]]

# clean “Unavailable”
if clean_unavailable_enabled:
    df.replace("Unavailable", "", inplace=True)

ws_values = None
ws_links = None

if args.ffill:
    wb_values = load_workbook(excel_file_path, data_only=True)
    ws_values = wb_values["Ark1"]

    # --- merge-aware filling for ALL columns ---
    for col in df.columns:
        fill_column_from_merges(df, ws_values, col)

if extract_hyperlinks:
    # We need formulas to parse HYPERLINK/HYPERLÄNK. With data_only=True, openpyxl
    # returns the cached *display* value (e.g. "HR") and drops the formula string.
    wb_links = load_workbook(excel_file_path, data_only=False)
    ws_links = wb_links["Ark1"]

# --- export merged-cell coordinates (optional) ---

def _export_merges_json(df, ws, out_path: str):
    # Only export merges that overlap the data area (rows after header, columns in df)
    data_row_min = HEADER_ROWS_IN_EXCEL + 1  # Excel row index where data starts
    data_row_max = ws.max_row
    data_col_min = 1
    data_col_max = len(df.columns)

    merges = []
    for mr in ws.merged_cells.ranges:
        min_row = max(mr.min_row, data_row_min)
        max_row = min(mr.max_row, data_row_max)
        min_col = max(mr.min_col, data_col_min)
        max_col = min(mr.max_col, data_col_max)

        # Skip merges that are fully outside the data region
        if min_row > max_row or min_col > max_col:
            continue

        # Translate Excel coords -> df coords
        df_min_row = dataframe_row(min_row)
        df_max_row = dataframe_row(max_row)
        if df_max_row < 0:
            continue
        if df_min_row < 0:
            df_min_row = 0
        if df_min_row >= len(df):
            continue
        if df_max_row >= len(df):
            df_max_row = len(df) - 1

        min_col_idx = min_col - 1
        max_col_idx = max_col - 1
        if min_col_idx < 0 or min_col_idx >= len(df.columns):
            continue
        if max_col_idx < 0:
            continue
        if max_col_idx >= len(df.columns):
            max_col_idx = len(df.columns) - 1

        top_left_value = ws.cell(mr.min_row, mr.min_col).value
        merges.append(
            {
                "minRow": int(df_min_row),
                "maxRow": int(df_max_row),
                "minColIndex": int(min_col_idx),
                "maxColIndex": int(max_col_idx),
                "minCol": str(df.columns[min_col_idx]),
                "maxCol": str(df.columns[max_col_idx]),
                "value": "" if top_left_value is None else str(top_left_value),
            }
        )

    payload = {
        "source": os.path.basename(excel_file_path),
        "sheet": "Ark1",
        "headerRowsSkipped": HEADER_ROWS_IN_EXCEL,
        "columns": list(map(str, df.columns)),
        "rowCount": int(len(df)),
        "merges": merges,
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


if args.export_merges:
    # Ensure we have the worksheet loaded
    if ws_values is None:
        wb_values = load_workbook(excel_file_path, data_only=True)
        ws_values = wb_values["Ark1"]
    _export_merges_json(df, ws_values, merges_json_path)
    print(f"Wrote {merges_json_path}")

# --- hyperlink extraction ---

if extract_hyperlinks and ws_links is not None and "Links to Database" in df.columns:
    links_col_idx = df.columns.get_loc("Links to Database") + 1

    for row in ws_links.iter_rows(min_row=HEADER_ROWS_IN_EXCEL + 1, max_row=ws_links.max_row):
        cell = row[links_col_idx - 1]
        text, url = extract_hyperlink(cell)
        if text and url:
            di = dataframe_row(cell.row)
            if 0 <= di < len(df):
                df.at[di, "Links to Database"] = f"[{text}]({url})"

# --- text normalization (before link-merging / dedup) ---

def normalize_text(v):
    if v is None or pd.isna(v):
        return ""
    s = str(v)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"(?<=\S)\n(?=\S)", "; ", s)
    s = re.sub(r"(^\n|\n$)", "", s)
    return s.strip()


def normalize_newlines_to_space(v):
    if v is None or pd.isna(v):
        return ""
    s = str(v)
    # Only normalize hard line breaks from Excel cells; keep other spacing intact.
    # Excel can contain various line separator characters depending on source.
    s = re.sub(r"[\r\n\u2028\u2029\u0085\x0b\x0c]+", " ", s)
    # Collapse repeated spaces introduced by line break removal.
    s = re.sub(r" {2,}", " ", s)
    return s.strip()

if normalize_text_enabled:
    df = df.apply(lambda col: col.map(normalize_text))
elif normalize_newlines_only:
    df = df.apply(lambda col: col.map(normalize_newlines_to_space))

# --- drop completely empty rows ---

if args.drop_empty_rows:
    before = len(df)
    empty_mask = df.apply(lambda col: col.fillna("").astype(str).str.strip().eq(""))
    df = df.loc[~empty_mask.all(axis=1)].reset_index(drop=True)
    after = len(df)
    if before != after:
        print(f"Dropped {before - after} completely empty rows")

 # --- merge links within the same Shelf mark ---

# Some sources store one link per row. We want *all* links for the same manuscript
# (same Shelf mark) to be merged into a single cell value. If the same Shelf mark
# can occur in different repositories, include Depository in the grouping key.
#
# Important: we do NOT collapse/aggregate other columns here; we simply compute the
# merged link list and apply it back to every row for the same Shelf mark.
if args.link_merge and "Links to Database" in df.columns and "Shelf mark" in df.columns:

    def _is_blank(v) -> bool:
        if v is None:
            return True
        if pd.isna(v):
            return True
        if isinstance(v, str) and v.strip() == "":
            return True
        return False

    def _join_unique_links(series: pd.Series) -> str:
        seen, out = set(), []

        # If a markdown link like "[HR](...)" exists, drop the bare label "HR".
        md_label_re = re.compile(r"^\[([^\]]+)\]\(([^)]+)\)$")
        labels_with_urls = set()
        for v in series:
            if _is_blank(v):
                continue
            s = str(v).strip()
            m = md_label_re.match(s)
            if m:
                labels_with_urls.add(m.group(1))

        for v in series:
            if _is_blank(v):
                continue
            s = str(v).strip()
            if s in labels_with_urls:
                continue
            if s not in seen:
                seen.add(s)
                out.append(s)
        return "; ".join(out) if out else ""

    group_cols = ["Shelf mark"]
    if "Depository" in df.columns:
        group_cols.insert(0, "Depository")

    # Compute merged links per (Depository, Shelf mark), preserving first-occurrence order.
    merged_by_key = (
        df.groupby(group_cols, sort=False)["Links to Database"]
        .apply(_join_unique_links)
    )

    df["Links to Database"] = df.set_index(group_cols).index.map(merged_by_key).fillna("")

# --- drop duplicate rows ---

if args.dedup:
    before = len(df)
    df = df.drop_duplicates(keep="first").reset_index(drop=True)
    after = len(df)
    if before != after:
        print(f"Dropped {before - after} duplicate rows")

# --- write TSV ---

# Note: In some datasets, rows that are distinct in-memory can serialize to identical TSV lines
# (typically due to escaping/normalization). To guarantee the output file has no duplicate rows,
# we also de-duplicate the serialized TSV body lines.
buf = io.StringIO()
df.to_csv(
    buf,
    sep="\t",
    index=False,
    quoting=csv.QUOTE_MINIMAL,
    quotechar="\x00",
    lineterminator="\n",
)

tsv_text = buf.getvalue()
lines = tsv_text.splitlines(True)

if lines and args.dedup:
    header, body = lines[0], lines[1:]
    seen, unique_body = set(), []
    for line in body:
        if line not in seen:
            seen.add(line)
            unique_body.append(line)

    dropped = len(body) - len(unique_body)
    if dropped:
        print(f"Dropped {dropped} duplicate rows (TSV output)")

    with open(tsv_file_path, "w", encoding="utf-8", newline="") as f:
        f.write(header)
        f.writelines(unique_body)
else:
    with open(tsv_file_path, "w", encoding="utf-8", newline="") as f:
        f.write(tsv_text)

print(f"Wrote {tsv_file_path}")
