
import os
from pathlib import Path
import pandas as pd
import csv

# This script lives in data/scripts; the data folder is one level up.
data_folder = Path(__file__).resolve().parents[1]

# Each tuple lists candidate filenames in preference order.
# First match wins: Sheets pipeline output, then Excel pipeline, then legacy _ffill.
sources = [
    ("Metadata_Dan.tsv",  "1.0_Metadata_Dan.tsv",  "1.0_Metadata_Dan_ffill.tsv"),
    ("Metadata_Isl.tsv",  "1.1_Metadata_Isl.tsv",  "1.1_Metadata_Isl_ffill.tsv"),
    ("Metadata_Norw.tsv", "1.2_Metadata_Norw.tsv", "1.2_Metadata_Norw_ffill.tsv"),
    ("Metadata_Swe.tsv",  "1.1_Metadata_Swe.tsv",  "1.1_Metadata_Swe_ffill.tsv"),
]

tsv_files = []
missing = []
for candidates in sources:
    found = next((c for c in candidates if (data_folder / c).exists()), None)
    if found:
        tsv_files.append(found)
    else:
        missing.append(candidates)

if not tsv_files:
    raise FileNotFoundError(
        f"No TSV files found in {data_folder}. Expected per-language one of: {sources}"
    )

if missing:
    print("Warning: missing TSV sources for some languages:")
    for candidates in missing:
        print(f"  - {' / '.join(candidates)}")

dfs = []
for fname in tsv_files:
    path = str(data_folder / fname)
    # Infer language from filename
    if "Dan" in fname or "dan" in fname:
        lang = "da"
    elif "Isl" in fname or "isl" in fname:
        lang = "is"
    elif "Swe" in fname or "swe" in fname:
        lang = "sv"
    elif "Norw" in fname or "norw" in fname:
        lang = "no"
    else:
        lang = "unknown"
    df = pd.read_csv(path, sep='\t', dtype=str)
    # Insert language column after 'Shelf mark'
    shelf_idx = list(df.columns).index("Shelf mark")
    df.insert(shelf_idx + 1, "Language", lang)
    dfs.append(df)

# Concatenate all
combined = pd.concat(dfs, ignore_index=True)
# Write to new TSV
combined.to_csv(
    str(data_folder / "NordicLaw_data.tsv"),
    sep='\t',
    index=False,
    quoting=csv.QUOTE_MINIMAL,
    quotechar="\x00",
)
print("Combined TSV written to NordicLaw_data.tsv")