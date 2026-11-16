#!/usr/bin/env python3
"""
Build data/iiif_manifests.json: the IIIF manifests behind the "Links to Database"
links, for the in-app image viewer (js/render/iiif-modal.js).

Recognised links:
  manuscripta.se/ms/<id>  ->  https://www.manuscripta.se/iiif/<id>/manifest.json
                              (also covers Alvin and data.kb.se images, which
                              manuscripta's manifests reference)
  nb.no/items/<id>        ->  https://api.nb.no/catalog/v1/iiif/<id>/manifest
  handrit.is/manuscript/view/<lang>/<id>
                          ->  data/iiif/handrit/<id>.json, a static IIIF Presentation 3
                              manifest written here from the <facsimile> of the
                              manuscript's TEI file (handrit.is has no IIIF; its
                              images are plain JPEGs, about 1200 px wide)

A link is indexed only when its manifest exists and has at least one canvas, so
the index (not the "(not digitised)" link labels) decides where the viewer is
offered. Output:

  { "ms:100255": { "manifest": "<url>", "canvases": 210 }, "nb:<id>": {...},
    "hr:am02-0286": { "manifest": "data/iiif/handrit/AM02-0286.json", "canvases": 56 } }

The handrit manifests need a local clone of https://github.com/Handrit/Manuscripts
(--handrit). Without it, the existing hr: entries and manifest files are kept.

Usage:
  python data/scripts/build_iiif_index.py                   # fetch manifests live
  python data/scripts/build_iiif_index.py --dump <dir>      # manuscripta manifests from a
                                                            # local eXist dump (<dir>/<id>/manifest.json)
  python data/scripts/build_iiif_index.py --handrit <Handrit/Manuscripts clone>
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
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

# handrit.is: links -> TEI files in a Handrit/Manuscripts clone -> static manifests.
HANDRIT_LINK_RE = re.compile(r"^https?://(?:www\.)?handrit\.is/manuscript/view/[a-z]{2}/([^/#?\s]+)", re.I)
HANDRIT_TEI_RE = re.compile(r"^(.+)-(?:is|da|en)\.xml$")
HANDRIT_DIR = "data/iiif/handrit"  # relative to the repo root (and the site root)
SITE_URL = "https://nordiclawbooks.github.io/database/"  # the manifests' public ids
TEI = "{http://www.tei-c.org/ns/1.0}"
XML_BASE = "{http://www.w3.org/XML/1998/namespace}base"

# <desc> of a surface: [accMat|addMat]0001[bis]r[-FB|-RB|-FFl|-RFl]
SURFACE_DESC_RE = re.compile(r"^(accMat|addMat)?0*(\d+)(bis)?([rv])(?:-(FB|RB|FFl|RFl))?$")
SURFACE_PARTS = {
    "FB": "Front board", "RB": "Rear board", "FFl": "Front flyleaf", "RFl": "Rear flyleaf",
    "accMat": "Accompanying material", "addMat": "Additional material",
}


def surface_label(desc: str) -> str:
    """Canvas label for a TEI surface <desc>: "0001r" -> "f. 1r" (the viewer matches
    folio loci against "f. <n><r|v>"), "0001r-FFl" -> "Front flyleaf 1r",
    "0000v-FB" -> "Front board, verso", "accMat0002r" -> "Accompanying material 2r".
    Anything else is returned as-is."""
    d = (desc or "").strip()
    m = SURFACE_DESC_RE.match(d)
    if not m:
        return d
    mat, num, bis, side, part = m.groups()
    leaf = f"{int(num)}{'bis' if bis else ''}"
    if part in ("FB", "RB"):
        name = SURFACE_PARTS[part] + (f" {leaf}" if int(num) else "")
        return f"{name}, {'recto' if side == 'r' else 'verso'}"
    if part or mat:
        return f"{SURFACE_PARTS[part or mat]} {leaf}{side}"
    return f"f. {leaf}{side}"


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
    except (OSError, json.JSONDecodeError) as e:  # URLError, timeouts, resets
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


def handrit_tei_files(clone: Path) -> dict[str, list[Path]]:
    """TEI files of a Handrit/Manuscripts clone by manuscript id (lower case)."""
    files: dict[str, list[Path]] = {}
    for path in clone.rglob("*.xml"):
        m = HANDRIT_TEI_RE.match(path.name)
        if m:
            files.setdefault(m.group(1).lower(), []).append(path)
    return files


def _px(value: str | None) -> int:
    m = re.match(r"\s*(\d+)", value or "")
    return int(m.group(1)) if m else 0


def handrit_facsimile(path: Path) -> tuple[str, str, list[dict]] | None:
    """(id, shelfmark, surfaces) from a TEI file; None without usable images.
    Each surface: {label, image, width, height, thumb, thumb_width, thumb_height}."""
    text = path.read_text(encoding="utf-8")
    try:
        root = ET.fromstring(text)
        fac = root.find(f".//{TEI}facsimile")
    except ET.ParseError as e:
        # A few files are malformed elsewhere (the description); their image list can still be read.
        block = re.search(r"<facsimile\b.*?</facsimile>", text, re.S)
        if not block:
            print(f"  ! {path}: {e}", file=sys.stderr)
            return None
        try:
            fac = ET.fromstring(block.group(0).replace("<facsimile", f'<facsimile xmlns="{TEI[1:-1]}"', 1))
        except ET.ParseError:
            print(f"  ! {path}: {e}", file=sys.stderr)
            return None
        root = None
    base = (fac.get(XML_BASE) or "") if fac is not None else ""
    if fac is None or not base.startswith("https://"):
        return None
    surfaces = []
    for surface in fac.findall(f"{TEI}surface"):
        image = thumb = None
        for g in surface.findall(f"{TEI}graphic"):
            url = g.get("url") or ""
            if url.endswith("/SECONDARY_DISPLAY"):
                image = g
            elif url.endswith("/THUMBNAIL"):
                thumb = g
        if image is None or not _px(image.get("width")) or not _px(image.get("height")):
            continue
        desc = surface.findtext(f"{TEI}desc") or surface.get("n") or ""
        s = {"label": surface_label(desc), "image": base + image.get("url"),
             "width": _px(image.get("width")), "height": _px(image.get("height"))}
        if thumb is not None:
            s.update(thumb=base + thumb.get("url"), thumb_width=_px(thumb.get("width")),
                     thumb_height=_px(thumb.get("height")))
        surfaces.append(s)
    if not surfaces:
        return None
    ident = HANDRIT_TEI_RE.match(path.name).group(1)
    if root is not None:
        idno = root.findtext(f".//{TEI}msDesc/{TEI}msIdentifier/{TEI}idno")
    else:
        m = re.search(r"<msIdentifier>.*?<idno>([^<]+)</idno>", text, re.S)
        idno = m.group(1) if m else None
    idno = (idno or ident).strip()
    return ident, idno, surfaces


def handrit_manifest(ident: str, shelfmark: str, surfaces: list[dict]) -> dict:
    """A IIIF Presentation 3 manifest for handrit.is images (no image service)."""
    mid = f"{SITE_URL}{HANDRIT_DIR}/{ident}.json"
    items = []
    for i, s in enumerate(surfaces):
        cid = f"{mid}/canvas/{i}"
        canvas = {
            "id": cid, "type": "Canvas", "label": {"none": [s["label"]]},
            "width": s["width"], "height": s["height"],
            "items": [{"id": f"{cid}/page", "type": "AnnotationPage", "items": [{
                "id": f"{cid}/image", "type": "Annotation", "motivation": "painting", "target": cid,
                "body": {"id": s["image"], "type": "Image", "format": "image/jpeg",
                         "width": s["width"], "height": s["height"]},
            }]}],
        }
        if s.get("thumb"):
            canvas["thumbnail"] = [{"id": s["thumb"], "type": "Image", "format": "image/jpeg",
                                    "width": s["thumb_width"], "height": s["thumb_height"]}]
        items.append(canvas)
    return {
        "@context": "http://iiif.io/api/presentation/3/context.json",
        "id": mid, "type": "Manifest",
        "label": {"none": [shelfmark]},
        "homepage": [{"id": f"https://handrit.is/manuscript/view/is/{ident}", "type": "Text",
                      "label": {"none": [f"{shelfmark} on handrit.is"]}, "format": "text/html"}],
        "requiredStatement": {"label": {"en": ["Images"]}, "value": {"en": ["handrit.is"]}},
        "behavior": ["paged"],
        "items": items,
    }


def build_handrit(ids: set[str], clone: Path, repo_root: Path) -> dict:
    """Write data/iiif/handrit/<id>.json for each linked manuscript with images;
    remove stale ones. Returns the index entries."""
    tei = handrit_tei_files(clone)
    out_dir = repo_root / HANDRIT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    entries, written = {}, set()
    for key in sorted(ids):
        best = None
        for path in sorted(tei.get(key, [])):
            fac = handrit_facsimile(path)
            if fac and (best is None or len(fac[2]) > len(best[2])):
                best = fac
        if not best:
            continue
        ident, shelfmark, surfaces = best
        name = f"{ident}.json"
        manifest = handrit_manifest(ident, shelfmark, surfaces)
        (out_dir / name).write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        written.add(name)
        entries[f"hr:{key}"] = {"manifest": f"{HANDRIT_DIR}/{name}", "canvases": len(surfaces)}
    for stale in out_dir.glob("*.json"):
        if stale.name not in written:
            stale.unlink()
    print(f"  {len(ids)} handrit.is links, {len(entries)} with images ({sum(e['canvases'] for e in entries.values())} canvases)")
    return entries


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
    parser.add_argument("--handrit", type=Path, default=None,
                        help="Local clone of github.com/Handrit/Manuscripts: write data/iiif/handrit/<id>.json "
                             "from the TEI <facsimile>s. Without it, existing handrit entries are kept.")
    parser.add_argument("--out", type=Path, default=repo_root / "data/iiif_manifests.json")
    args = parser.parse_args(argv)

    tsvs = sorted((repo_root / "data").glob("Metadata_*_raw.tsv"))
    if not tsvs:
        print("No data/Metadata_*_raw.tsv files found.", file=sys.stderr)
        return 1
    index = build_index(tsvs, args.dump)
    handrit_ids = {m.group(1).lower() for tsv in tsvs for url in links_in_tsv(tsv) if (m := HANDRIT_LINK_RE.match(url))}
    if args.handrit:
        index.update(build_handrit(handrit_ids, args.handrit, repo_root))
    elif args.out.exists():  # no clone: keep the handrit entries (and files) we have
        old = json.loads(args.out.read_text(encoding="utf-8"))
        index.update({k: v for k, v in old.items() if k.startswith("hr:") and (repo_root / v["manifest"]).exists()})
    index = dict(sorted(index.items()))
    args.out.write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  wrote {args.out.relative_to(repo_root) if args.out.is_relative_to(repo_root) else args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
