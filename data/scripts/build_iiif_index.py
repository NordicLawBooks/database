#!/usr/bin/env python3
"""
Build data/iiif_manifests.json: the IIIF manifests behind the "Links to Database"
links, for the in-app image viewer (js/render/iiif-modal.js).

Recognised links:
  manuscripta.se/ms/<id>  ->  https://www.manuscripta.se/iiif/<id>/manifest.json
                              (also covers Alvin and data.kb.se images, which
                              manuscripta's manifests reference)
  nb.no/items/<id>        ->  https://api.nb.no/catalog/v1/iiif/<id>/manifest

A link is indexed only when its manifest exists and has at least one canvas, so
the index (not the "(not digitised)" link labels) decides where the viewer is
offered. Output:

  { "ms:100255": { "manifest": "<url>", "canvases": 210 }, "nb:<id>": {...} }

Usage:
  python data/scripts/build_iiif_index.py                   # fetch manifests live
  python data/scripts/build_iiif_index.py --dump <dir>      # manuscripta manifests from a
                                                            # local eXist dump (<dir>/<id>/manifest.json)
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

LINKS_COLUMN = "Links to Database"
URL_RE = re.compile(r"https?://[^\s;()\[\]]+")

# (key prefix, link pattern, manifest URL template). Keep in sync with IIIF_SOURCES in js/model/iiif.js.
PROVIDERS = [
    ("ms", re.compile(r"^https?://(?:www\.)?manuscripta\.se/ms/(\d+)", re.I),
     "https://www.manuscripta.se/iiif/{id}/manifest.json"),
    ("nb", re.compile(r"^https?://(?:www\.)?nb\.no/items/([0-9a-f]{32})", re.I),
     "https://api.nb.no/catalog/v1/iiif/{id}/manifest"),
]

USER_AGENT = "NordicLaw-iiif-index/1.0"


def key_for_url(url: str) -> tuple[str, str] | None:
    """(index key, manifest URL) for a link, or None when it isn't a IIIF source."""
    for prefix, pattern, template in PROVIDERS:
        m = pattern.match(url)
        if m:
            ident = m.group(1).lower() if prefix == "nb" else m.group(1)
            return f"{prefix}:{ident}", template.format(id=ident)
    return None


def links_in_tsv(path: Path) -> set[str]:
    urls: set[str] = set()
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t", quotechar="\x00")
        for row in reader:
            urls.update(URL_RE.findall(row.get(LINKS_COLUMN) or ""))
    return urls


def canvas_count(manifest: dict) -> int:
    if isinstance(manifest.get("items"), list):  # Presentation 3
        return sum(1 for it in manifest["items"] if it.get("type") == "Canvas")
    seqs = manifest.get("sequences") or []
    return len(seqs[0].get("canvases") or []) if seqs else 0


def fetch_json(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print(f"  ! {url}: HTTP {e.code}", file=sys.stderr)
        return None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        print(f"  ! {url}: {e}", file=sys.stderr)
        return None


def load_manifest(key: str, url: str, dump: Path | None) -> dict | None:
    if dump and key.startswith("ms:"):
        path = dump / key[3:] / "manifest.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"  ! {path}: {e}", file=sys.stderr)
            return None
    return fetch_json(url)


def build_index(tsvs: list[Path], dump: Path | None) -> dict:
    targets: dict[str, str] = {}
    for tsv in tsvs:
        for url in links_in_tsv(tsv):
            hit = key_for_url(url)
            if hit:
                targets[hit[0]] = hit[1]

    def check(item):
        key, url = item
        manifest = load_manifest(key, url, dump)
        n = canvas_count(manifest) if isinstance(manifest, dict) else 0
        return key, url, n

    index = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for key, url, n in pool.map(check, sorted(targets.items())):
            if n > 0:
                index[key] = {"manifest": url, "canvases": n}
    print(f"  {len(targets)} IIIF-capable links, {len(index)} with a manifest")
    return dict(sorted(index.items()))


def main(argv: list[str]) -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dump", type=Path, default=None,
                        help="Local manuscripta IIIF dump (<dir>/<id>/manifest.json) instead of fetching manuscripta live.")
    parser.add_argument("--out", type=Path, default=repo_root / "data/iiif_manifests.json")
    args = parser.parse_args(argv)

    tsvs = sorted((repo_root / "data").glob("Metadata_*_raw.tsv"))
    if not tsvs:
        print("No data/Metadata_*_raw.tsv files found.", file=sys.stderr)
        return 1
    index = build_index(tsvs, args.dump)
    args.out.write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  wrote {args.out.relative_to(repo_root) if args.out.is_relative_to(repo_root) else args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
