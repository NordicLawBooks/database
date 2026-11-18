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
  sprogsamlinger.ku.dk/q.php?p=ds/hjem/mapper/<folder>  (NorS)
                          ->  data/iiif/nors/<folder>.json, a static manifest of all
                              the folder's images (one range per subfolder, page
                              folders first), for manuscripts with no images from the
                              sources above and links not labelled "only binding
                              digitised"

A link is indexed only when its manifest exists and has at least one canvas, so
the index (not the "(not digitised)" link labels) decides where the viewer is
offered. Output:

  { "ms:100255": { "manifest": "<url>", "canvases": 210 }, "nb:<id>": {...},
    "hr:am02-0286": { "manifest": "data/iiif/handrit/AM02-0286.json", "canvases": 56 } }

The handrit manifests need a local clone of https://github.com/Handrit/Manuscripts
(--handrit). Without it, the existing hr: entries and manifest files are kept.

The NorS manifests are written with --nors. NorS has no IIIF and serves its images
one at a time, so a folder that already has a manifest is not fetched again
(--nors-refresh rebuilds them all). Without --nors, the existing ns: entries are kept.

Usage:
  python data/scripts/build_iiif_index.py                   # fetch manifests live
  python data/scripts/build_iiif_index.py --dump <dir>      # manuscripta manifests from a
                                                            # local eXist dump (<dir>/<id>/manifest.json)
  python data/scripts/build_iiif_index.py --handrit <Handrit/Manuscripts clone>
  python data/scripts/build_iiif_index.py --nors            # also NorS folders without a manifest
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import urllib.error
import urllib.parse
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


# NorS (sprogsamlinger.ku.dk): no IIIF either. A link names a folder ("mappe"); its
# ?t= JSON lists subfolders (usually folio ranges) and images. The images are plain
# JPEGs from ds-img.php: the full scan (2-3.5 MB) and, with "thumb", a copy at 1/8 of
# its size, rounded up. The viewer (js/render/mirador.js) shows that copy until zoomed.
NORS_BASE = "https://sprogsamlinger.ku.dk/"
NORS_LINK_RE = re.compile(r"^https?://sprogsamlinger\.ku\.dk/q\.php\?p=ds/hjem/mapper/(\d+)", re.I)
NORS_DIR = "data/iiif/nors"
MD_LINK_RE = re.compile(r"\[([^\]]*)\]\((https?://[^)\s]+)\)")
# Link labels for NorS folders that hold no manuscript pages ("NorS (only binding digitised)").
NORS_SKIP_LABEL_RE = re.compile(r"only\s+binding", re.I)
# Every subfolder is used, as a range named after it. Folders of pages come first: their
# names start with a folio, page or leaf range ("1r-17r", "s. 1-62", "bl. 10r-19v",
# "bind bl. 1-9v", "1. læg …"), unless they are colour photographs or extra copies.
NORS_PAGE_RE = re.compile(r"^\s*(?:bind\s+)?(?:(?:s|bl|ff?)\.?\s*)?\d", re.I)
NORS_NOT_PAGES_RE = re.compile(r"farve|portræt|portraet|ekstra|kopi", re.I)
# Restoration series in a folder name; page folders are grouped by series, so that
# "1-11 (under rest.)" and "1-20r (før rest.)" don't interleave. Unmarked folders
# are taken as part of the "før rest." series when there is one (AM 41 8vo's
# "80v-100r" fills the gap in its "før rest." folders), otherwise they come first.
NORS_REST_RE = re.compile(r"\b(efter|før|under)\s+rest", re.I)
NORS_REST_RANK = {None: 0, "efter": 1, "før": 2, "under": 3}


def manuscripts_in_tsv(path: Path) -> list[tuple[str, list[tuple[str, str]]]]:
    """(shelfmark, [(label, url), …]) per manuscript, from the Markdown links of its rows."""
    out: list[tuple[str, list[tuple[str, str]]]] = []
    with path.open("r", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t", quotechar="\x00"):
            shelfmark = (row.get("Shelf mark") or "").strip()
            if shelfmark and (not out or out[-1][0] != shelfmark):
                out.append((shelfmark, []))
            if out:
                out[-1][1].extend(MD_LINK_RE.findall(row.get(LINKS_COLUMN) or ""))
    return out


def nors_order_folders(subfolders: list[str]) -> list[str]:
    """All subfolders: those of pages first, by restoration series and first number (NorS
    sorts names as text), then the rest (portraits, binding, colour photographs, …) in
    NorS's order."""
    def is_pages(name: str) -> bool:
        return bool(NORS_PAGE_RE.match(name)) and not NORS_NOT_PAGES_RE.search(name)

    def series(name: str) -> str | None:
        m = NORS_REST_RE.search(name)
        return m.group(1).lower() if m else None

    unmarked = "før" if any(series(n) == "før" for n in subfolders) else None

    def page_key(item: tuple[int, str]) -> tuple:
        pos, name = item
        first = re.search(r"\d+", name)
        return NORS_REST_RANK[series(name) or unmarked], int(first.group(0)), pos

    pages = sorted(((i, n) for i, n in enumerate(subfolders) if is_pages(n)), key=page_key)
    return [n for _, n in pages] + [n for n in subfolders if not is_pages(n)]


NORS_PAUSE = 0.5  # seconds between the starts of two NorS requests, to go easy on the server
_nors_last = 0.0


def nors_get(url: str, *, attempts: int = 5):
    """A response from NorS, retried: name resolution fails now and then, and the
    server stalls on parallel image requests, so callers ask for one thing at a time,
    at least NORS_PAUSE apart."""
    import time
    global _nors_last
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        wait = _nors_last + NORS_PAUSE - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _nors_last = time.monotonic()
        try:
            return urllib.request.urlopen(req, timeout=30)
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == attempts - 1:
                raise
            print(f"  ! {url}: {e}; retrying", file=sys.stderr)
            time.sleep(1 + 2 * attempt)


NORS_PAGE_SIZE = 50  # images per page of a folder listing; /mapper/<id>/<n> gives page n


def nors_folder(mappe: str) -> dict:
    """{title, subfolders: [(name, mappe)], images: [path]} for a NorS folder, with the
    images of every listing page. Past the last page NorS starts over rather than
    returning nothing, so paging stops at a short page or at an image seen before."""
    def page(n: int) -> dict:
        with nors_get(f"{NORS_BASE}q.php?t=ds/hjem/mapper/{mappe}/{n}") as resp:
            return json.load(resp)["page"]["parts"]

    def page_images(parts: dict) -> list[str]:
        return [urllib.parse.unquote(m.group(1)) for c in parts.get("billedkort", {}).get("data", [])
                if (m := re.search(r"[?&]path=(.*)$", c.get("img", "")))]

    parts = page(0)
    head = (parts.get("hoved", {}).get("data") or [{}])[0]
    title = next((v for k, v in head.items() if k.endswith("_text")), "").strip()
    subs = [(s["first_text"].strip(), s["href"].rsplit("/", 1)[1])
            for s in parts.get("mappeliste", {}).get("data", [])]
    images = page_images(parts)
    seen = set(images)
    n, last = 1, images
    while len(last) >= NORS_PAGE_SIZE:
        last = [i for i in page_images(page(n)) if i not in seen]
        images += last
        seen.update(last)
        n += 1
    return {"title": title, "subfolders": subs, "images": images}


def nors_image_url(path: str, thumb: bool = False) -> str:
    q = {"thumb": "200x200", "path": path} if thumb else {"path": path}
    return f"{NORS_BASE}projects/sprogsamlinger/ds-img.php?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)


def jpeg_size(url: str) -> tuple[int, int]:
    """Width and height from a JPEG's SOF marker; stops downloading once it is read."""
    with nors_get(url) as resp:
        buf = b""
        while True:
            chunk = resp.read(8192)
            if not chunk:
                raise ValueError(f"no JPEG size in {url}")
            buf += chunk
            i = 2
            while i + 9 <= len(buf):
                if buf[i] != 0xFF:
                    raise ValueError(f"not a JPEG: {url}")
                marker, seglen = buf[i + 1], int.from_bytes(buf[i + 2:i + 4], "big")
                if marker in (0xC0, 0xC1, 0xC2):
                    return int.from_bytes(buf[i + 7:i + 9], "big"), int.from_bytes(buf[i + 5:i + 7], "big")
                i += 2 + seglen


def nors_manifest(mappe: str, label: str, groups: list[tuple[str, list[str]]]) -> dict:
    """A IIIF Presentation 3 manifest for a NorS folder: one range per subfolder.
    Sizes come from the 1/8 copies, so the full scans are never downloaded here; the
    full size is taken as 8x (at most 7 px over, as NorS rounds the copy up)."""
    mid = f"{SITE_URL}{NORS_DIR}/{mappe}.json"
    items, structures = [], []
    for name, paths in groups:
        canvases = []
        for n, path in enumerate(paths, 1):
            tw, th = jpeg_size(nors_image_url(path, thumb=True))
            w, h = tw * 8, th * 8
            cid = f"{mid}/canvas/{len(items)}"
            items.append({
                "id": cid, "type": "Canvas", "label": {"none": [f"{name}, {n}"]},
                "width": w, "height": h,
                "items": [{"id": f"{cid}/page", "type": "AnnotationPage", "items": [{
                    "id": f"{cid}/image", "type": "Annotation", "motivation": "painting", "target": cid,
                    "body": {"id": nors_image_url(path), "type": "Image", "format": "image/jpeg",
                             "width": w, "height": h},
                }]}],
                # Mirador stretches a thumbnail without a declared size.
                "thumbnail": [{"id": nors_image_url(path, thumb=True), "type": "Image",
                               "format": "image/jpeg", "width": tw, "height": th}],
            })
            canvases.append({"id": cid, "type": "Canvas"})
        structures.append({"id": f"{mid}/range/{len(structures)}", "type": "Range",
                           "label": {"none": [name]}, "items": canvases})
    return {
        "@context": "http://iiif.io/api/presentation/3/context.json",
        "id": mid, "type": "Manifest",
        "label": {"none": [label]},
        "homepage": [{"id": f"{NORS_BASE}q.php?p=ds/hjem/mapper/{mappe}", "type": "Text",
                      "label": {"none": [f"{label} on NorS sprogsamlinger"]}, "format": "text/html"}],
        "requiredStatement": {"label": {"en": ["Images"]},
                              "value": {"en": ["NorS sprogsamlinger, University of Copenhagen"]}},
        "items": items,
        "structures": structures,
    }


def nors_targets(tsvs: list[Path], index: dict) -> dict[str, list[str]]:
    """NorS folder -> the shelfmarks linking to it, for manuscripts without images from
    another source in `index` and links not labelled as binding-only."""
    targets: dict[str, list[str]] = {}
    for tsv in tsvs:
        for shelfmark, links in manuscripts_in_tsv(tsv):
            if any((hit := key_for_url(url)) and hit[0] in index for _, url in links):
                continue
            if any((m := HANDRIT_LINK_RE.match(url)) and f"hr:{m.group(1).lower()}" in index for _, url in links):
                continue
            for label, url in links:
                m = NORS_LINK_RE.match(url)
                if m and not NORS_SKIP_LABEL_RE.search(label):
                    targets.setdefault(m.group(1), [])
                    if shelfmark not in targets[m.group(1)]:
                        targets[m.group(1)].append(shelfmark)
    return targets


def build_nors(targets: dict[str, list[str]], repo_root: Path, refresh: bool,
               only: set[str] | None = None) -> dict:
    """Write data/iiif/nors/<mappe>.json for each target folder with images; keep
    existing ones unless `refresh` (the photographs rarely change, and every image costs
    NorS a request); remove those no longer linked. With `only`, (re)build just those
    folders and leave the others as they are. Returns the index entries."""
    out_dir = repo_root / NORS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    entries, written = {}, set()
    for mappe, shelfmarks in sorted(targets.items(), key=lambda t: int(t[0])):
        path = out_dir / f"{mappe}.json"
        build = mappe in only if only is not None else refresh or not path.exists()
        if not build:
            if not path.exists():
                continue
            n = canvas_count(json.loads(path.read_text(encoding="utf-8")))
        else:
            try:
                folder = nors_folder(mappe)
                sub_ids = dict(folder["subfolders"])
                label = shelfmarks[0] if len(shelfmarks) == 1 else folder["title"] or ", ".join(shelfmarks)
                groups = [(label, folder["images"])] if folder["images"] else []
                for name in nors_order_folders([name for name, _ in folder["subfolders"]]):
                    sub = nors_folder(sub_ids[name])
                    groups.append((name, sub["images"]))
                    # One level further down, for folders that only hold folders.
                    groups += [(f"{name} / {n}", nors_folder(i)["images"]) for n, i in sub["subfolders"]]
                groups = [(name, paths) for name, paths in groups if paths]
                print(f"  NorS {mappe} {label}: {sum(len(p) for _, p in groups)} images in {len(groups)} folders")
                if not groups:
                    continue
                manifest = nors_manifest(mappe, label, groups)
            except (OSError, ValueError, KeyError) as e:
                print(f"  ! NorS {mappe}: {e}", file=sys.stderr)
                if not path.exists():
                    continue
                manifest = json.loads(path.read_text(encoding="utf-8"))  # keep the old one
            path.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
            n = canvas_count(manifest)
        written.add(path.name)
        entries[f"ns:{mappe}"] = {"manifest": f"{NORS_DIR}/{path.name}", "canvases": n}
    for stale in out_dir.glob("*.json"):
        if stale.name not in written:
            stale.unlink()
    print(f"  {len(targets)} NorS folders without other images, {len(entries)} with a manifest "
          f"({sum(e['canvases'] for e in entries.values())} canvases)")
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
    parser.add_argument("--nors", action="store_true",
                        help="Write data/iiif/nors/<folder>.json for NorS links of manuscripts without other "
                             "images, fetching only folders that have none yet. Without it, existing NorS "
                             "entries are kept.")
    parser.add_argument("--nors-refresh", action="store_true",
                        help="With --nors: rebuild every NorS manifest, not only the missing ones.")
    parser.add_argument("--nors-only", default=None, metavar="FOLDER,…",
                        help="With --nors: (re)build only these NorS folders (the numbers in the links), "
                             "keeping the other NorS manifests as they are.")
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
    if args.nors:  # after the other sources: NorS only stands in where they have no images
        only = {f.strip() for f in args.nors_only.split(",") if f.strip()} if args.nors_only else None
        index.update(build_nors(nors_targets(tsvs, index), repo_root, args.nors_refresh, only))
    elif args.out.exists():  # keep the NorS entries (and files) we have
        old = json.loads(args.out.read_text(encoding="utf-8"))
        index.update({k: v for k, v in old.items() if k.startswith("ns:") and (repo_root / v["manifest"]).exists()})
    index = dict(sorted(index.items()))
    args.out.write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  wrote {args.out.relative_to(repo_root) if args.out.is_relative_to(repo_root) else args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
