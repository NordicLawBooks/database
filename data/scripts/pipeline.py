"""
NordicLaw data pipeline — orchestrates the per-language conversion scripts.

QUICK REFERENCE
---------------

Regenerate everything from Excel (most common):

    python data/scripts/pipeline.py all

Regenerate only the raw TSVs + merge JSON (needed before extract_segments.py):

    python data/scripts/pipeline.py raw

Regenerate the filled/combined TSVs (used for the fallback NordicLaw_data.tsv):

    python data/scripts/pipeline.py filled
    python data/scripts/pipeline.py combine

Regenerate from Google Sheets instead of Excel:

    python data/scripts/pipeline.py sheets --sheet-id <ID> [--credentials key.json]

After running `raw`, regenerate the segments JSON for the details modal:

    python data/scripts/extract_segments.py

DRY RUN
-------
Add --dry-run to any subcommand to print what would be run without executing:

    python data/scripts/pipeline.py all --dry-run

SUBCOMMANDS
-----------
  all      filled + raw + combine in one go (default end-to-end workflow)
  filled   Per-language filled TSVs: Metadata_Dan.tsv, Metadata_Isl.tsv, …
  raw      Per-language raw TSVs + merge JSON: Metadata_Dan_raw.tsv,
           Metadata_Dan_raw_merges.json, … (Excel-identical, blanks preserved)
  combine  Merge the four filled TSVs into data/NordicLaw_data.tsv
  sheets   Fetch directly from Google Sheets (requires API credentials)

OUTPUT FILES
------------
  data/Metadata_Dan_raw.tsv          Raw rows, blanks preserved (merge-aligned)
  data/Metadata_Dan_raw_merges.json  Merge geometry for the Manuscript View renderer
  data/Metadata_Dan.tsv              Filled/deduplicated rows
  data/NordicLaw_data.tsv            Combined fallback (all four languages)
  data/Metadata_Dan_segments.json      Per-manuscript modal data (from extract_segments.py)
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path
from typing import Iterable


DEFAULT_EXCEL_FILES = [
    "data/1.1_Metadata_Dan.xlsx",
    "data/1.2_Metadata_Isl.xlsx",
    "data/1.2.1_Metadata_Isl.xlsx",
    "data/1.1_Metadata_Swe.xlsx",
    "data/1.3_Metadata_Norw.xlsx",
]

# Mapping from raw source files to segment output files.
# Output names match the paths referenced in js/data/manifest.js.
SEGMENTS_SOURCES = [
    {
        "raw_tsv":     "data/Metadata_Dan_raw.tsv",
        "merges_json": "data/Metadata_Dan_raw_merges.json",
        "out":         "data/Metadata_Dan_segments.json",
    },
    {
        "raw_tsv":     "data/Metadata_Isl_raw.tsv",
        "merges_json": "data/Metadata_Isl_raw_merges.json",
        "out":         "data/Metadata_Isl_segments.json",
    },
    {
        "raw_tsv":     "data/Metadata_Norw_raw.tsv",
        "merges_json": "data/Metadata_Norw_raw_merges.json",
        "out":         "data/Metadata_Norw_segments.json",
    },
    {
        "raw_tsv":     "data/Metadata_Swe_raw.tsv",
        "merges_json": "data/Metadata_Swe_raw_merges.json",
        "out":         "data/Metadata_Swe_segments.json",
    },
]


def repo_root_from_this_file() -> Path:
    # data/scripts/pipeline.py -> repo root
    return Path(__file__).resolve().parents[2]


def _existing_paths(repo_root: Path, rel_paths: Iterable[str]) -> list[Path]:
    out: list[Path] = []
    missing: list[str] = []
    for p in rel_paths:
        abs_path = (repo_root / p).resolve()
        if abs_path.exists():
            out.append(abs_path)
        else:
            missing.append(p)
    if missing:
        raise FileNotFoundError(
            "Missing input file(s):\n" + "\n".join(f"- {p}" for p in missing)
        )
    return out


def run_cmd(cmd: list[str], *, cwd: Path, dry_run: bool) -> None:
    printable = " ".join(
        f'"{c}"' if (" " in c or "\t" in c) else c
        for c in cmd
    )
    print(f"$ {printable}")
    if dry_run:
        return
    subprocess.run(cmd, cwd=str(cwd), check=True)


def run_convert_excel_to_tsv(
    *,
    repo_root: Path,
    excel_path: Path,
    mode: str,
    export_merges: bool,
    dry_run: bool,
) -> None:
    convert_script = (repo_root / "data/scripts/convert_excel_to_tsv.py").resolve()
    if not convert_script.exists():
        raise FileNotFoundError(f"Missing script: {convert_script}")

    cmd: list[str] = [sys.executable, str(convert_script), str(excel_path)]

    if mode == "raw":
        cmd.append("--excel-identical")
        # Merged view depends on *_raw_merges.json for exact rowspan/colspan.
        cmd.append("--export-merges")
    elif mode == "filled":
        if export_merges:
            cmd.append("--export-merges")
    else:
        raise ValueError(f"Unknown mode: {mode}")

    run_cmd(cmd, cwd=repo_root, dry_run=dry_run)


def run_convert_sheets_to_tsv(
    *,
    repo_root: Path,
    sheet_id: str,
    credentials: str | None,
    raw: bool,
    export_merges: bool,
    dry_run: bool,
) -> None:
    script = (repo_root / "data/scripts/convert_sheets_to_tsv.py").resolve()
    if not script.exists():
        raise FileNotFoundError(f"Missing script: {script}")

    cmd: list[str] = [
        sys.executable, str(script),
        "--sheet-id", sheet_id,
        "--all-sheets",
        "--out-dir", str(repo_root / "data"),
    ]
    if credentials:
        cmd += ["--credentials", credentials]
    if raw:
        cmd.append("--raw")
    if export_merges:
        cmd.append("--export-merges")

    run_cmd(cmd, cwd=repo_root, dry_run=dry_run)


def run_combine_tsv_files(*, repo_root: Path, dry_run: bool) -> None:
    combine_script = (repo_root / "data/scripts/combine_tsv_files.py").resolve()
    if not combine_script.exists():
        raise FileNotFoundError(f"Missing script: {combine_script}")

    run_cmd([sys.executable, str(combine_script)], cwd=repo_root, dry_run=dry_run)


def run_extract_segments(*, repo_root: Path, dry_run: bool) -> None:
    script = (repo_root / "data/scripts/extract_segments.py").resolve()
    if not script.exists():
        raise FileNotFoundError(f"Missing script: {script}")

    for src in SEGMENTS_SOURCES:
        raw_tsv = repo_root / src["raw_tsv"]
        merges_json = repo_root / src["merges_json"]
        out = repo_root / src["out"]

        if not raw_tsv.exists():
            print(f"  Skipping segments for {src['raw_tsv']} (file not found)")
            continue
        if not merges_json.exists():
            print(f"  Skipping segments for {src['merges_json']} (file not found)")
            continue

        run_cmd(
            [
                sys.executable, str(script),
                "--raw-tsv", str(raw_tsv),
                "--merges-json", str(merges_json),
                "--out", str(out),
            ],
            cwd=repo_root,
            dry_run=dry_run,
        )


def add_common_excel_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--excel-files",
        nargs="*",
        default=None,
        help=(
            "Excel files to process (paths relative to repo root). "
            "If omitted, uses the 4 default Metadata_*.xlsx files under data/."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print commands without executing them.",
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="NordicLaw conversion pipeline — orchestrates the per-language conversion scripts.",
        epilog=(
            "Examples:\n"
            "  python data/scripts/pipeline.py all\n"
            "  python data/scripts/pipeline.py raw --dry-run\n"
            "  python data/scripts/pipeline.py sheets --sheet-id <ID> --credentials key.json\n"
            "\n"
            "After running 'raw' you can regenerate segments separately with:\n"
            "  python data/scripts/pipeline.py segments"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    sub = parser.add_subparsers(dest="command", required=True)

    p_filled = sub.add_parser(
        "filled",
        help="Generate per-language filled TSVs (*.tsv) from Excel sources.",
    )
    add_common_excel_args(p_filled)
    p_filled.add_argument(
        "--export-merges",
        action="store_true",
        help="Also write *_merges.json sidecars for the filled TSVs.",
    )

    p_raw = sub.add_parser(
        "raw",
        help="Generate *_raw.tsv and *_raw_merges.json sidecars (Excel-identical).",
    )
    add_common_excel_args(p_raw)

    p_combine = sub.add_parser(
        "combine",
        help="Combine per-language TSVs into data/NordicLaw_data.tsv.",
    )
    p_combine.add_argument(
        "--dry-run",
        action="store_true",
        help="Print commands without executing them.",
    )

    p_sheets = sub.add_parser(
        "sheets",
        help="Fetch all four language tabs from Google Sheets and combine (Sheets-first workflow).",
    )
    p_sheets.add_argument("--sheet-id", required=True, help="Google Sheets spreadsheet ID (from the URL)")
    p_sheets.add_argument("--credentials", default=None, help="Path to service account JSON key")
    p_sheets.add_argument("--skip-filled", action="store_true", help="Skip generating filled TSVs.")
    p_sheets.add_argument("--skip-raw", action="store_true", help="Skip generating *_raw.tsv + *_raw_merges.json.")
    p_sheets.add_argument("--skip-segments", action="store_true", help="Skip generating *_segments.json files.")
    p_sheets.add_argument("--skip-combine", action="store_true", help="Skip combining into NordicLaw_data.tsv.")
    p_sheets.add_argument("--dry-run", action="store_true", help="Print commands without executing them.")

    p_segments = sub.add_parser(
        "segments",
        help="Generate *_segments.json for all four languages from existing *_raw.tsv + *_raw_merges.json.",
    )
    p_segments.add_argument(
        "--dry-run",
        action="store_true",
        help="Print commands without executing them.",
    )

    p_all = sub.add_parser(
        "all",
        help="Run filled + raw + segments + combine from Excel (full end-to-end workflow).",
    )
    add_common_excel_args(p_all)
    p_all.add_argument(
        "--export-merges",
        action="store_true",
        help="Also write *_merges.json sidecars for the filled TSVs.",
    )
    p_all.add_argument(
        "--skip-filled",
        action="store_true",
        help="Skip generating filled TSVs.",
    )
    p_all.add_argument(
        "--skip-raw",
        action="store_true",
        help="Skip generating raw TSVs + merge JSON.",
    )
    p_all.add_argument(
        "--skip-segments",
        action="store_true",
        help="Skip generating *_segments.json files.",
    )
    p_all.add_argument(
        "--skip-combine",
        action="store_true",
        help="Skip combining TSVs into NordicLaw_data.tsv.",
    )

    args = parser.parse_args(argv)

    repo_root = repo_root_from_this_file()
    print(f"Repo root: {repo_root}")

    if args.command in {"filled", "raw", "all"}:
        excel_files = args.excel_files or DEFAULT_EXCEL_FILES
        excel_paths = _existing_paths(repo_root, excel_files)

    if args.command == "filled":
        for excel in excel_paths:
            run_convert_excel_to_tsv(
                repo_root=repo_root,
                excel_path=excel,
                mode="filled",
                export_merges=bool(args.export_merges),
                dry_run=bool(args.dry_run),
            )
        return 0

    if args.command == "raw":
        for excel in excel_paths:
            run_convert_excel_to_tsv(
                repo_root=repo_root,
                excel_path=excel,
                mode="raw",
                export_merges=True,
                dry_run=bool(args.dry_run),
            )
        return 0

    if args.command == "combine":
        run_combine_tsv_files(repo_root=repo_root, dry_run=bool(args.dry_run))
        return 0

    if args.command == "segments":
        run_extract_segments(repo_root=repo_root, dry_run=bool(args.dry_run))
        return 0

    if args.command == "sheets":
        if not args.skip_filled:
            run_convert_sheets_to_tsv(
                repo_root=repo_root,
                sheet_id=args.sheet_id,
                credentials=args.credentials,
                raw=False,
                export_merges=False,
                dry_run=bool(args.dry_run),
            )
        if not args.skip_raw:
            run_convert_sheets_to_tsv(
                repo_root=repo_root,
                sheet_id=args.sheet_id,
                credentials=args.credentials,
                raw=True,
                export_merges=True,
                dry_run=bool(args.dry_run),
            )
        if not args.skip_segments:
            run_extract_segments(repo_root=repo_root, dry_run=bool(args.dry_run))
        if not args.skip_combine:
            run_combine_tsv_files(repo_root=repo_root, dry_run=bool(args.dry_run))
        return 0

    if args.command == "all":
        if not args.skip_filled:
            for excel in excel_paths:
                run_convert_excel_to_tsv(
                    repo_root=repo_root,
                    excel_path=excel,
                    mode="filled",
                    export_merges=bool(args.export_merges),
                    dry_run=bool(args.dry_run),
                )

        if not args.skip_raw:
            for excel in excel_paths:
                run_convert_excel_to_tsv(
                    repo_root=repo_root,
                    excel_path=excel,
                    mode="raw",
                    export_merges=True,
                    dry_run=bool(args.dry_run),
                )

        if not args.skip_segments:
            run_extract_segments(repo_root=repo_root, dry_run=bool(args.dry_run))

        if not args.skip_combine:
            run_combine_tsv_files(repo_root=repo_root, dry_run=bool(args.dry_run))

        return 0

    raise AssertionError("Unhandled command")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
