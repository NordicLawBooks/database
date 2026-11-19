#!/usr/bin/env python3
"""Export the NordicLaw Zotero group library to data/bibliography.json.

The group (https://www.zotero.org/groups/6768725/nordiclaw) is public, so no API
key is needed. Each top-level item becomes one entry:

    { "key": "QYCCT7IH",                      Zotero item key
      "creators": ["Schlyter"],                last names of the authors, else editors
      "year": "1877",                          "1868-1881" for a range
      "short": "Schlyter (1877)",              Short title, if set: the form the data cites it by
      "cites": ["SSGL 13", "SGL 13"],          series abbreviation + volume (SERIES_ABBREVIATIONS)
      "html": "Schlyter, Carl Johan, ed. 1877. <i>Ordbok …</i>. …",
      "text": the same without markup,
      "zotero": "https://www.zotero.org/groups/nordiclaw/items/QYCCT7IH",
      "url": the item's DOI or URL, if any,
      "iiif": [IIIF manifest URLs: linked-URL attachments, "IIIF: <url>" lines in Extra] }

js/model/bibliography.js matches Literature citations ("Schlyter (1877:12)")
against the Short title and against creators + year. Entries are sorted by their formatted text.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

API = "https://api.zotero.org"
DEFAULT_GROUP = 6768725
STYLE = "chicago-author-date"
REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "data" / "bibliography.json"
KEEP_TAGS = {"i", "b", "sup", "sub"}
# Series cited by abbreviation + volume in the Literature cells ("SSGL 9: XX-XXII").
# Key: text the item's Series contains (case-insensitive).
SERIES_ABBREVIATIONS = {
    "samling af sweriges gamla lagar": ["SSGL", "SGL"],
}
YEAR_RE = re.compile(r"(\d{4})(?:\s*[-–]\s*(\d{2,4}))?")


def fetch_all(group: int, path: str, params: str) -> list[dict]:
    out, start = [], 0
    while True:
        url = f"{API}/groups/{group}/{path}?format=json&limit=100&start={start}&{params}"
        req = urllib.request.Request(url, headers={"Zotero-API-Version": "3"})
        with urllib.request.urlopen(req, timeout=60) as r:
            total = int(r.headers.get("Total-Results", "0"))
            batch = json.load(r)
        out.extend(batch)
        start += len(batch)
        if not batch or start >= total:
            return out
        time.sleep(0.2)


class _Sanitizer(HTMLParser):
    """Keep text and a few inline tags (i, b, sup, sub); drop everything else."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.html: list[str] = []
        self.text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in KEEP_TAGS:
            self.html.append(f"<{tag}>")

    def handle_endtag(self, tag):
        if tag in KEEP_TAGS:
            self.html.append(f"</{tag}>")

    def handle_data(self, data):
        self.html.append(html.escape(data, quote=False))
        self.text.append(data)


def sanitize(bib: str) -> tuple[str, str]:
    p = _Sanitizer()
    p.feed(bib or "")
    norm = lambda s: re.sub(r"\s+", " ", s).strip()
    return norm("".join(p.html)), norm("".join(p.text))


def year_of(date: str) -> str:
    m = YEAR_RE.search(date or "")
    if not m:
        return ""
    if not m.group(2):
        return m.group(1)
    end = m.group(2)
    end = m.group(1)[: 4 - len(end)] + end  # 1868-81 -> 1868-1881
    return f"{m.group(1)}-{end}" if end != m.group(1) else m.group(1)


def creators_of(data: dict) -> list[str]:
    cs = data.get("creators", [])
    primary = [c for c in cs if c.get("creatorType") == "author"] or [c for c in cs if c.get("creatorType") == "editor"] or cs
    return [c.get("lastName") or c.get("name") or "" for c in primary if c.get("lastName") or c.get("name")]


def series_cites(data: dict) -> list[str]:
    series = (data.get("series") or "").casefold()
    vol = (data.get("volume") or data.get("seriesNumber") or "").strip()
    if not re.fullmatch(r"\d+", vol):
        return []
    return [f"{abbr} {vol}" for key, abbrs in SERIES_ABBREVIATIONS.items() if key in series for abbr in abbrs]


def is_manifest(att: dict) -> bool:
    url = att.get("url") or ""
    return att.get("linkMode") == "linked_url" and (
        "iiif" in (att.get("title") or "").lower() or re.search(r"manifest(\.json)?$", url) is not None
    )


def build(items: list[dict], children: list[dict]) -> list[dict]:
    manifests: dict[str, list[str]] = {}
    for c in children:
        d = c["data"]
        if d.get("itemType") == "attachment" and d.get("parentItem") and is_manifest(d):
            manifests.setdefault(d["parentItem"], []).append(d["url"])

    out = []
    for it in items:
        d = it["data"]
        if d.get("itemType") in ("attachment", "note", "annotation"):
            continue
        html_, text = sanitize(it.get("bib", ""))
        doi = d.get("DOI", "")
        entry = {
            "key": d["key"],
            "creators": creators_of(d),
            "year": year_of(d.get("date", "")),
            "html": html_ or html.escape(d.get("title", "")),
            "text": text or d.get("title", ""),
            "zotero": it.get("links", {}).get("alternate", {}).get("href", ""),
        }
        if d.get("shortTitle"):
            entry["short"] = d["shortTitle"]
        if cites := series_cites(d):
            entry["cites"] = cites
        url = f"https://doi.org/{doi}" if doi else d.get("url", "")
        if url:
            entry["url"] = url
        # Manifests from linked-URL attachments and from "IIIF: <url>" lines in Extra.
        iiif = manifests.get(d["key"], []) + re.findall(r"^IIIF:\s*(\S+)", d.get("extra", ""), re.M)
        if iiif:
            entry["iiif"] = list(dict.fromkeys(iiif))
        out.append(entry)
    out.sort(key=lambda e: (e["text"].casefold(), e["key"]))
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--group", type=int, default=DEFAULT_GROUP, help=f"Zotero group ID (default {DEFAULT_GROUP})")
    ap.add_argument("--out", default=str(OUT), help="Output JSON (default data/bibliography.json)")
    args = ap.parse_args(argv)

    items = fetch_all(args.group, "items/top", f"include=data,bib&style={STYLE}")
    children = fetch_all(args.group, "items", "itemType=attachment")
    entries = build(items, children)
    Path(args.out).write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(entries)} entries to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
