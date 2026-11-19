// The bibliography (data/bibliography.json, exported from the NordicLaw Zotero
// group by data/scripts/fetch_zotero.py) and the citations in Literature cells
// that refer to it: "Schlyter (1834:XXI-XXII; 1838:XL)", "Kålund 1889, 262-263".
// A citation matches an entry by its Short title in Zotero ("Schlyter (1877)",
// as the data cites it), or by author and year: the entry's first creator
// ("Schlyter"), all of them ("Schlyter and Collin", "&"/"och"/"og" too) or the
// first plus "et al."; the year is the entry's year or year range. A volume of
// a series cited by abbreviation ("SSGL 9: XX-XXII", "SGL 3", "SSGL 9 nr 104")
// matches the entry's `cites` forms ("SSGL 9"), derived by fetch_zotero.py.
// Registered once at startup (setBibliography), like the IIIF index, so the
// cell renderers can link citations without threading it through every view.

import { escapeHtml, fold } from "../util/text.js";

let entries = [];
let byKey = new Map(); // entry key -> entry
let byCite = new Map(); // "author|year" -> [entry]
let byAbbr = new Map(); // "ssgl 9" -> [entry]

const YEAR = String.raw`\d{4}(?:\s*[-–]\s*\d{2,4})?`;
const YEAR_RE = new RegExp(`^\\s*(${YEAR})`);
const PAREN_RE = /^([^()]*?)\s*\(([^)]*)\)/;
const BARE_RE = new RegExp(`^([^\\d(),;]+?)[\\s,]+(${YEAR})`);
// "SSGL 9", then an optional locator: ": XX-XXII", " nr 104", " s. XVII".
const NUM = String.raw`[0-9IVXLCDMivxlcdm]+`;
const RANGE = String.raw`${NUM}(?:\s*[-–]\s*${NUM})?`;
const ABBR_RE = new RegExp(String.raw`^(\p{Lu}+\s*\d+)(?:\s*:\s*${RANGE})?(?:\s+nr\.?\s*\d+)?(?:\s+s\.\s*${RANGE})?`, "u");

/** "SSGL9", "ssgl  9" -> "ssgl 9". */
const abbrKey = (s) => fold(s).replace(/(\D)\s*(\d)/, "$1 $2").replace(/\s+/g, " ").trim();

/** "1868 – 81" -> "1868-1881". */
export function normalizeYear(y) {
  const m = String(y || "").match(/(\d{4})(?:\s*[-–]\s*(\d{2,4}))?/);
  if (!m) return "";
  if (!m[2]) return m[1];
  const end = m[1].slice(0, 4 - m[2].length) + m[2];
  return end === m[1] ? m[1] : `${m[1]}-${end}`;
}

/** Author part of a citation as a lookup key: folded, "et al." and conjunctions unified. */
export function normalizeAuthor(a) {
  return fold(a)
    .replace(/[[\]]/g, "")
    .replace(/\bet\.?\s*al\.?/g, "et al")
    .replace(/\s+(?:och|og|&)\s+/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The author forms an entry can be cited by. */
export function citeForms(creators) {
  const names = (creators || []).filter(Boolean);
  if (!names.length) return [];
  const forms = new Set([names[0]]);
  if (names.length > 1) {
    forms.add(`${names[0]} et al`);
    forms.add(`${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
    forms.add(`${names.slice(0, -1).join(" ")} and ${names[names.length - 1]}`);
  }
  return [...forms].map(normalizeAuthor);
}

/** Register the parsed bibliography.json (an array of entries). */
export function setBibliography(list) {
  entries = Array.isArray(list) ? list : [];
  byKey = new Map(entries.map((e) => [e.key, e]));
  byCite = new Map();
  byAbbr = new Map();
  const add = (k, e) => {
    if (!byCite.has(k)) byCite.set(k, []);
    if (!byCite.get(k).includes(e)) byCite.get(k).push(e);
  };
  for (const e of entries) {
    const years = new Set([e.year, String(e.year || "").slice(0, 4)].filter(Boolean));
    for (const a of citeForms(e.creators)) {
      for (const y of years) add(`${a}|${y}`, e);
    }
    const sm = String(e.short || "").match(PAREN_RE);
    const sy = sm && sm[2].match(YEAR_RE);
    if (sy && sm[1].trim()) add(`${normalizeAuthor(sm[1])}|${normalizeYear(sy[1])}`, e);
    for (const c of e.cites || []) {
      const k = abbrKey(c);
      if (!byAbbr.has(k)) byAbbr.set(k, []);
      if (!byAbbr.get(k).includes(e)) byAbbr.get(k).push(e);
    }
  }
}

export function bibliographyEntries() {
  return entries;
}

export function bibliographyEntry(key) {
  return byKey.get(key) || null;
}

/**
 * Entries a citation (author text + year) refers to; also tries it without
 * leading or trailing initials ("N. Beckman", "Henning S" -> "beckman", "henning")
 * and, for a range, by its first year.
 */
export function findEntries(author, year) {
  const y = normalizeYear(year);
  const a = normalizeAuthor(author);
  const authors = [a, a.replace(/^(?:\p{L}\.\s*)+/u, ""), a.replace(/\s+\p{L}{1,2}\.?$/u, "")];
  for (const yy of new Set([y, y.slice(0, 4)])) {
    for (const aa of authors) {
      const hit = byCite.get(`${aa}|${yy}`);
      if (hit) return hit;
    }
  }
  return [];
}

/** Split at ";" / newlines outside parentheses, keeping the separators. */
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ";" || ch === "\n")) {
      parts.push(cur, ch);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

/**
 * A Literature value as tokens [{ text, entries? }]; joining the texts gives the
 * value back. A citation with one year is one token; one with several
 * ("Schlyter (1834:XXI; 1838:XL)") has a token per year, and the author goes
 * with the first.
 */
export function literatureTokens(value) {
  const s = value == null ? "" : String(value);
  const out = [];
  const plain = (text) => text && out.push({ text });
  for (const part of splitTop(s)) {
    const lead = part.match(/^\s*/)[0];
    const body = part.slice(lead.length);
    // Series volume by abbreviation: "SSGL 9: XX-XXII (nr 31) …" links "SSGL 9: XX-XXII".
    const am = body.match(ABBR_RE);
    const aents = am && byAbbr.get(abbrKey(am[1]));
    if (aents) {
      plain(lead);
      out.push({ text: am[0], entries: aents });
      plain(body.slice(am[0].length));
      continue;
    }
    const pm = body.match(PAREN_RE);
    if (pm && pm[1].trim() && YEAR_RE.test(pm[2])) {
      plain(lead);
      const segs = pm[2].split(";");
      const withYear = segs.filter((seg) => YEAR_RE.test(seg));
      if (withYear.length === 1) {
        // One work ("Hægstad (1906:9; 40-1)"): the whole citation is the link.
        const ents = findEntries(pm[1], withYear[0].match(YEAR_RE)[1]);
        if (ents.length) out.push({ text: pm[0], entries: ents });
        else plain(pm[0]);
      } else {
        // Several works: "Schlyter (" + one link per year + ")".
        plain(pm[0].slice(0, pm[0].length - pm[2].length - 1)); // "Schlyter ("
        segs.forEach((seg, i) => {
          if (i) plain(";");
          const y = seg.match(YEAR_RE);
          const ents = y ? findEntries(pm[1], y[1]) : [];
          if (!ents.length) return plain(seg);
          const ws = seg.match(/^\s*/)[0];
          plain(ws);
          out.push({ text: seg.slice(ws.length).trimEnd(), entries: ents });
          plain(seg.slice(ws.length + seg.slice(ws.length).trimEnd().length));
        });
        plain(")");
      }
      plain(body.slice(pm[0].length));
      continue;
    }
    const bm = body.match(BARE_RE);
    if (bm) {
      const ents = findEntries(bm[1], bm[2]);
      if (ents.length) {
        plain(lead);
        out.push({ text: bm[0], entries: ents });
        plain(body.slice(bm[0].length));
        continue;
      }
    }
    plain(part);
  }
  // Merge adjacent plain tokens.
  return out.reduce((acc, t) => {
    const last = acc[acc.length - 1];
    if (last && !last.entries && !t.entries) last.text += t.text;
    else acc.push({ ...t });
    return acc;
  }, []);
}

/** A Literature value as HTML, each matched citation a link that opens the bibliography there. */
export function literatureHtml(value) {
  return literatureTokens(value)
    .map(({ text, entries: ents }) => {
      if (!ents) return escapeHtml(text);
      const keys = ents.map((e) => e.key).join(" ");
      const title = ents.map((e) => e.text).join("\n");
      return `<a href="#bib-${escapeHtml(ents[0].key)}" class="bib-cite" data-bib-keys="${escapeHtml(keys)}" ` +
        `title="${escapeHtml(title)}">${escapeHtml(text)}</a>`;
    })
    .join("");
}
