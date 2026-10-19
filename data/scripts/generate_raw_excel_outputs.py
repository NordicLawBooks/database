from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


DEFAULT_EXCEL_FILES = [
    "data/1.0_Metadata_Dan.xlsx",
    "data/1.1_Metadata_Isl.xlsx",
    "data/1.1_Metadata_Swe.xlsx",
    "data/1.2_Metadata_Norw.xlsx",
]


def repo_root_from_this_file() -> Path:
    # data/scripts/generate_raw_excel_outputs.py -> repo root
    return Path(__file__).resolve().parents[2]


def run_convert(repo_root: Path, excel_path: str) -> None:
    excel = (repo_root / excel_path).resolve()
    if not excel.exists():
        raise FileNotFoundError(f"Missing file: {excel}")

    convert_script = (repo_root / "data/scripts/convert_excel_to_tsv.py").resolve()
    if not convert_script.exists():
        raise FileNotFoundError(f"Missing script: {convert_script}")

    cmd = [
        sys.executable,
        str(convert_script),
        str(excel),
        "--excel-identical",
        "--export-merges",
    ]

    subprocess.run(cmd, cwd=str(repo_root), check=True)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Generate *_raw.tsv and *_raw_merges.json sidecars for the NordicLaw web merged view. "
            "This calls data/scripts/convert_excel_to_tsv.py with --excel-identical --export-merges."
        )
    )
    parser.add_argument(
        "excel_files",
        nargs="*",
        help=(
            "Excel files to process (paths relative to repo root). "
            "If omitted, uses the 4 default Metadata_*.xlsx files under data/."
        ),
    )

    args = parser.parse_args(argv)
    repo_root = repo_root_from_this_file()

    excel_files = args.excel_files or DEFAULT_EXCEL_FILES

    print("Generating *_raw.tsv and *_raw_merges.json sidecars...")
    print(f"Repo root: {repo_root}")

    for f in excel_files:
        print(f"- {f}")
        run_convert(repo_root, f)

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
