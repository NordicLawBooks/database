#!/usr/bin/env python3
"""Extract structural segments from *_raw.tsv + *_raw_merges.json.

Goal
----
Turn Excel-like merged-cell regions (and unmerged single cells) into per-manuscript
"segments" with computed locus spans derived from the Leaves/Pages column.

This is intended as an intermediate representation suitable for:
- Modal popup hierarchy rendering
- PDF export
- Later TEI generation (e.g., handNote + locus)

Input conventions (as produced by convert_excel_to_tsv.py)
--------------------------------------------------------
- *_raw.tsv contains the sheet grid (blank cells preserved).
- *_raw_merges.json contains merge ranges as row/col intervals with a merge value.

Row indexing
------------
The merges JSON uses 0-based row indices relative to the TSV data rows
(excluding the TSV header row). i.e. minRow=0 refers to the first data row
immediately after the TSV header.

Usage
-----
  python data/scripts/extract_segments.py \
    --raw-tsv data/1.0_Metadata_Dan_raw.tsv \
    --merges-json data/1.0_Metadata_Dan_raw_merges.json \
    --out data/1.0_Metadata_Dan_segments.json

"""

from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


DEFAULT_SEGMENT_COLUMNS = [
    "Name",
    "Object",
    "Size",
    "Production Unit",
    "Main text",
    "Minor text",
    "Dating",
    "Gatherings",
    "Full size",
    "Leaf size",
    "Catch Words and Gatherings",
    "Pricking",
    "Material",
    "Ruling",
    "Columns",
    "Lines",
    "Script",
    "Rubric",
    "Scribe",
    "Production",
    "Style",
    "Colours",
    "Form of Initials",
    "Size of Initials",
    "Iconography",
    "Place",
    "Related Shelfmarks",
    "Literature",
    "Links to Database",
]


@dataclass(frozen=True)
class Segment:
    column: str
    start_row: int
    end_row: int
    label: str
    source: str  # "merge" or "cell"


@dataclass(frozen=True)
class LocusPoint:
    kind: str  # 'f' or 'p'
    n: int
    side: Optional[str]  # 'r' | 'v' | None

    def sort_key(self) -> Tuple[int, float]:
        # Order: n, then r < None < v
        if self.side == 'r':
            side_val = 0.0
        elif self.side == 'v':
            side_val = 1.0
        else:
            side_val = 0.5
        return (self.n, side_val)


_LOCI_PREFIX_RE = re.compile(r"^\s*(f{1,2}|p{1,2})\.\s*", re.IGNORECASE)
_RANGE_SPLIT_RE = re.compile(r"\s*[-–]\s*")


REPO_ROOT = Path(__file__).resolve().parents[2]


def _repo_relative(path: Path) -> str:
    """POSIX path relative to the repo root when inside it (else as given)."""
    p = Path(path).resolve()
    try:
        return p.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return Path(path).as_posix()


def read_tsv_rows(path: Path) -> List[Dict[str, str]]:
    with path.open('r', encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f, delimiter='\t', quotechar='\x00')
        rows: List[Dict[str, str]] = []
        for r in reader:
            rows.append({k: (v if v is not None else "") for k, v in r.items()})
        return rows


def read_merges(path: Path) -> Dict[str, Any]:
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def normalize_space(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def forward_fill(rows: List[Dict[str, str]], field: str) -> List[str]:
    out: List[str] = []
    cur = ""
    for r in rows:
        v = normalize_space(r.get(field, ""))
        if v:
            cur = v
        out.append(cur)
    return out


def group_rows_by_shelfmark(rows: List[Dict[str, str]]) -> List[Tuple[str, int, int]]:
    # Uses forward-filled Shelf mark; groups consecutive rows with same value.
    shelfmarks = forward_fill(rows, "Shelf mark")
    groups: List[Tuple[str, int, int]] = []
    if not shelfmarks:
        return groups

    cur = shelfmarks[0]
    start = 0
    for i in range(1, len(shelfmarks)):
        if shelfmarks[i] != cur:
            groups.append((cur, start, i - 1))
            cur = shelfmarks[i]
            start = i
    groups.append((cur, start, len(shelfmarks) - 1))

    # Filter empties (defensive)
    return [(k, a, b) for (k, a, b) in groups if k]


def build_merge_segments(merges_json: Dict[str, Any], allowed_columns: Iterable[str]) -> List[Segment]:
    allowed = set(allowed_columns)
    segs: List[Segment] = []
    for m in merges_json.get("merges", []) or []:
        min_col = m.get("minCol")
        max_col = m.get("maxCol")
        if not min_col or not max_col:
            continue
        if min_col != max_col:
            continue
        col = str(min_col)
        if col not in allowed:
            continue

        try:
            a = int(m.get("minRow"))
            b = int(m.get("maxRow"))
        except Exception:
            continue
        if a > b:
            a, b = b, a

        label = normalize_space(str(m.get("value", "")))
        segs.append(Segment(column=col, start_row=a, end_row=b, label=label, source="merge"))

    # Sort for downstream processing.
    segs.sort(key=lambda s: (s.column, s.start_row, s.end_row))
    return segs


def index_intervals(segments: List[Segment]) -> Dict[str, List[Tuple[int, int]]]:
    by_col: Dict[str, List[Tuple[int, int]]] = {}
    for s in segments:
        by_col.setdefault(s.column, []).append((s.start_row, s.end_row))
    for col in by_col:
        by_col[col].sort()
    return by_col


def interval_contains(intervals: List[Tuple[int, int]], idx: int) -> bool:
    # intervals sorted by start. Small list, linear scan is fine.
    for a, b in intervals:
        if idx < a:
            return False
        if a <= idx <= b:
            return True
    return False


def build_cell_segments(
    rows: List[Dict[str, str]],
    allowed_columns: Iterable[str],
    merge_intervals: Dict[str, List[Tuple[int, int]]],
) -> List[Segment]:
    allowed = set(allowed_columns)
    segs: List[Segment] = []

    for i, r in enumerate(rows):
        for col in allowed:
            v = normalize_space(r.get(col, ""))
            if not v:
                continue
            if interval_contains(merge_intervals.get(col, []), i):
                # This cell is inside a merged region; we already represent it via merge segment.
                continue
            segs.append(Segment(column=col, start_row=i, end_row=i, label=v, source="cell"))

    segs.sort(key=lambda s: (s.column, s.start_row, s.end_row))
    return segs


def parse_locus_point(token: str, *, default_n: Optional[int] = None) -> Optional[Tuple[int, Optional[str]]]:
    t = normalize_space(token)
    if not t:
        return None

    # Handle shorthand like "v" or "r" meaning same number as start.
    if t.lower() in ("r", "v"):
        if default_n is None:
            return None
        return (default_n, t.lower())

    # Strip leading parentheses and punctuation.
    t = t.lstrip("([{").rstrip(")]}" )

    # Ignore obvious non-locus strings.
    # Accept optional leading '*' used for uncertain folios.
    m = re.match(r"^\*?(\d+)(?:\s*([rv]))?", t, re.IGNORECASE)
    if not m:
        return None
    n = int(m.group(1))
    side = m.group(2).lower() if m.group(2) else None
    return (n, side)


def parse_leaves_pages_cell(value: str) -> List[Tuple[str, LocusPoint, LocusPoint, str]]:
    """Return list of (kind, startPoint, endPoint, prefixText).

    prefixText preserves the original prefix token if present (e.g. "ff." or "p.").
    kind is normalized to 'f' or 'p'.

    If the string is unparseable, returns empty list.
    """

    raw = normalize_space(value)
    if not raw:
        return []

    # Drop surrounding parentheses for parsing, but keep raw otherwise.
    stripped = raw.strip()
    stripped = stripped[1:-1].strip() if (stripped.startswith('(') and stripped.endswith(')')) else stripped

    # Some values contain multiple ranges separated by ';' or ','
    parts = [p.strip() for p in re.split(r"\s*;\s*|\s*,\s*", stripped) if p.strip()]

    out: List[Tuple[str, LocusPoint, LocusPoint, str]] = []
    for part in parts:
        pfx_match = _LOCI_PREFIX_RE.match(part)
        prefix_text = ""
        kind: Optional[str] = None
        rest = part
        if pfx_match:
            grp = pfx_match.group(1).lower()
            prefix_text = f"{grp}."
            kind = 'f' if grp.startswith('f') else 'p'
            rest = part[pfx_match.end():].strip()
        else:
            # Heuristic: if r/v present, treat as folio.
            kind = 'f' if re.search(r"\d\s*[rv]", part, re.IGNORECASE) else None
            rest = part

        # Split range
        chunks = _RANGE_SPLIT_RE.split(rest, maxsplit=1)
        start_tok = chunks[0].strip() if chunks else ""
        end_tok = chunks[1].strip() if len(chunks) > 1 else start_tok

        start_parsed = parse_locus_point(start_tok)
        if not start_parsed:
            continue
        start_n, start_side = start_parsed
        end_parsed = parse_locus_point(end_tok, default_n=start_n)
        if not end_parsed:
            # If end token can't be parsed, use start as end.
            end_n, end_side = start_n, start_side
        else:
            end_n, end_side = end_parsed

        k = kind or 'f'  # Default to folio if ambiguous.
        if not prefix_text:
            prefix_text = 'ff.' if k == 'f' else 'pp.'

        start_pt = LocusPoint(kind=k, n=start_n, side=start_side)
        end_pt = LocusPoint(kind=k, n=end_n, side=end_side)

        # Ensure start <= end
        if start_pt.sort_key() <= end_pt.sort_key():
            out.append((k, start_pt, end_pt, prefix_text))
        else:
            out.append((k, end_pt, start_pt, prefix_text))

    return out


def render_locus(prefix: str, start: LocusPoint, end: LocusPoint) -> str:
    def fmt(pt: LocusPoint) -> str:
        return f"{pt.n}{pt.side or ''}"  # keep empty side if missing

    # Keep a space after prefix when prefix ends with '.'
    pre = prefix
    if not pre.endswith('.'):
        pre += '.'
    return f"{pre} {fmt(start)}-{fmt(end)}"


def compute_segment_locus(
    rows: List[Dict[str, str]],
    manuscript_start: int,
    manuscript_end: int,
    seg: Segment,
) -> Dict[str, Any]:
    # Collect locus candidates from Leaves/Pages in the segment interval.
    # Prefer in-interval values; if nothing parseable is found, keep evidence only.

    leaves_vals: List[str] = []
    for i in range(seg.start_row, seg.end_row + 1):
        if i < 0 or i >= len(rows):
            continue
        v = normalize_space(rows[i].get("Leaves/Pages", ""))
        if v:
            leaves_vals.append(v)

    parsed: List[Tuple[str, LocusPoint, LocusPoint, str]] = []
    for v in leaves_vals:
        parsed.extend(parse_leaves_pages_cell(v))

    if not parsed:
        return {
            "kind": None,
            "from": None,
            "to": None,
            "rendered": None,
            "evidence": {
                "leavesPages": leaves_vals,
            },
        }

    # Do not mix folios/pages: select per-kind.
    by_kind: Dict[str, List[Tuple[LocusPoint, LocusPoint, str]]] = {}
    for k, a, b, pfx in parsed:
        by_kind.setdefault(k, []).append((a, b, pfx))

    if len(by_kind.keys()) > 1:
        # Mixed kinds in the same segment (unexpected per your note) => keep evidence.
        return {
            "kind": "mixed",
            "from": None,
            "to": None,
            "rendered": None,
            "evidence": {
                "leavesPages": leaves_vals,
                "parsedKinds": sorted(by_kind.keys()),
            },
        }

    kind = next(iter(by_kind.keys()))
    points = by_kind[kind]

    # Compute min start and max end.
    min_start: Optional[LocusPoint] = None
    max_end: Optional[LocusPoint] = None
    chosen_prefix = points[0][2] if points else ('ff.' if kind == 'f' else 'pp.')

    for a, b, pfx in points:
        if min_start is None or a.sort_key() < min_start.sort_key():
            min_start = a
            chosen_prefix = pfx or chosen_prefix
        if max_end is None or b.sort_key() > max_end.sort_key():
            max_end = b

    if min_start is None or max_end is None:
        return {
            "kind": kind,
            "from": None,
            "to": None,
            "rendered": None,
            "evidence": {
                "leavesPages": leaves_vals,
            },
        }

    rendered = render_locus(chosen_prefix, min_start, max_end)
    return {
        "kind": kind,
        "from": f"{min_start.n}{min_start.side or ''}",
        "to": f"{max_end.n}{max_end.side or ''}",
        "prefix": chosen_prefix,
        "rendered": rendered,
        "evidence": {
            "leavesPages": leaves_vals,
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-tsv", required=True, help="Path to *_raw.tsv")
    ap.add_argument("--merges-json", required=True, help="Path to *_raw_merges.json")
    ap.add_argument("--out", required=True, help="Output JSON path")
    ap.add_argument(
        "--segment-columns",
        default=",".join(DEFAULT_SEGMENT_COLUMNS),
        help="Comma-separated list of columns that should produce segments.",
    )
    args = ap.parse_args()

    raw_tsv = Path(args.raw_tsv)
    merges_json_path = Path(args.merges_json)
    out_path = Path(args.out)

    seg_cols = [normalize_space(c) for c in str(args.segment_columns).split(",") if normalize_space(c)]
    # Leaves/Pages is used to compute locus, but should not create segments.
    seg_cols = [c for c in seg_cols if c.lower() != "leaves/pages".lower()]

    rows = read_tsv_rows(raw_tsv)
    merges_json = read_merges(merges_json_path)

    merge_segments = build_merge_segments(merges_json, seg_cols)
    merge_intervals = index_intervals(merge_segments)
    cell_segments = build_cell_segments(rows, seg_cols, merge_intervals)

    all_segments = merge_segments + cell_segments
    all_segments.sort(key=lambda s: (s.column, s.start_row, s.end_row, s.source))

    manuscripts = group_rows_by_shelfmark(rows)

    # Precompute forward-filled manuscript-level fields.
    shelfmarks = forward_fill(rows, "Shelf mark")
    depositories = forward_fill(rows, "Depository")

    out_manuscripts: List[Dict[str, Any]] = []

    for shelfmark, ms_start, ms_end in manuscripts:
        ms_rows = rows[ms_start : ms_end + 1]
        depository = depositories[ms_start] if ms_start < len(depositories) else ""

        ms_segments: List[Dict[str, Any]] = []
        for seg in all_segments:
            if seg.end_row < ms_start or seg.start_row > ms_end:
                continue
            # Expect segments to be contained within manuscript.
            if seg.start_row < ms_start or seg.end_row > ms_end:
                continue

            locus = compute_segment_locus(rows, ms_start, ms_end, seg)

            ms_segments.append(
                {
                    "column": seg.column,
                    "label": seg.label,
                    "startRow": seg.start_row - ms_start,
                    "endRow": seg.end_row - ms_start,
                    "startRowAbs": seg.start_row,
                    "endRowAbs": seg.end_row,
                    "source": seg.source,
                    "locus": locus,
                }
            )

        # Group by column for easier UI consumption.
        by_col: Dict[str, List[Dict[str, Any]]] = {}
        for s in ms_segments:
            by_col.setdefault(s["column"], []).append(s)

        out_manuscripts.append(
            {
                "Shelfmark": shelfmark,
                "Depository": depository,
                "rowRangeAbs": {"start": ms_start, "end": ms_end},
                "rowCount": (ms_end - ms_start + 1),
                "segmentsByColumn": by_col,
            }
        )

    out_obj = {
        "source": {
            # Repo-relative, so the output doesn't depend on whose machine ran it.
            "rawTsv": _repo_relative(raw_tsv),
            "mergesJson": _repo_relative(merges_json_path),
            "excel": merges_json.get("source"),
            "sheet": merges_json.get("sheet"),
        },
        "segmentColumns": seg_cols,
        "manuscripts": out_manuscripts,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out_obj, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
