
import os
from pathlib import Path
import pandas as pd
import csv

# This script lives in data/scripts; the data folder is one level up.
data_folder = Path(__file__).resolve().parents[1]

# The per-language filled TSVs written by convert_sheets_to_tsv.py.
sources = ["Metadata_Dan.tsv", "Metadata_Isl.tsv", "Metadata_Norw.tsv", "Metadata_Swe.tsv"]

tsv_files = [f for f in sources if (data_folder / f).exists()]
missing = [f for f in sources if f not in tsv_files]

if not tsv_files:
    raise FileNotFoundError(
        f"No TSV files found in {data_folder}. Expected: {sources}"
    )

if missing:
    print("Warning: missing TSV sources for some languages:")
    for f in missing:
        print(f"  - {f}")

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