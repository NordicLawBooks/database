// Pure field-level parsers, normalizers, and facet-value extractors.
//
// Ported verbatim (behavior-preserving) from the legacy table.js so the regex
// edge cases — Dating ranges, Lines ranges, roman-numeral production units,
// folio/page normalization — stay identical. These are the highest-risk
// functions to change, hence the dedicated tests in tests/fields.test.js.

import { normalizeForCompare, splitSemicolonList } from "../util/text.js";

// ---------------------------------------------------------------------------
// Dating
// ---------------------------------------------------------------------------

/**
 * Parse a Dating string to an overall {min, max} year range, or null.
 * Example: "1363 (ff. 18-23 1500-1525)" => { min: 1363, max: 1525 }
 * Years outside 500–1800 are excluded (they are usually literature/reference years).
 */
export function parseDatingRange(dating) {
  if (dating === null || dating === undefined) return null;
  const s = String(dating);
  if (!s.trim()) return null;
  const years = [];

  // Year ranges (3–4 digits; include both endpoints).
  const rangeRe = /(\d{3,4})\s*[-–]\s*(\d{3,4})/g;
  let m;
  while ((m = rangeRe.exec(s)) !== null) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (Number.isFinite(a)) years.push(a);
    if (Number.isFinite(b)) years.push(b);
  }

  // Individual 4-digit years.
  const yearRe = /(\d{4})/g;
  while ((m = yearRe.exec(s)) !== null) {
    const y = Number(m[1]);
    if (Number.isFinite(y)) years.push(y);
  }

  // Century shorthand (e.g. "1200s" => 1200–1299).
  const centuryRe = /(\d{3})00s/g;
  while ((m = centuryRe.exec(s)) !== null) {
    const start = Number(String(m[1]) + "00");
    if (Number.isFinite(start)) {
      years.push(start);
      years.push(start + 99);
    }
  }

  // Ordinal centuries, conventional span (e.g. "12th century" => 1101–1200,
  // "14th century" => 1301–1400). This is the inverse of parseCentury, so a
  // century label round-trips: parseCentury(parseDatingRange("12th c.").min) === "12th".
  const ordinalCenturyRe = /(\d{1,2})(?:th|st|nd|rd)\s*cent/gi;
  while ((m = ordinalCenturyRe.exec(s)) !== null) {
    const c = Number(m[1]);
    if (Number.isFinite(c) && c >= 1) {
      years.push((c - 1) * 100 + 1); // e.g. 1101
      years.push(c * 100); // e.g. 1200
    }
  }

  const filtered = years
    .filter((y) => typeof y === "number" && Number.isFinite(y))
    .filter((y) => y >= 500 && y <= 1800);
  if (filtered.length === 0) return null;

  return { min: Math.min(...filtered), max: Math.max(...filtered) };
}

/** Earliest year in a Dating string, or null. */
export function parseDatingYear(dating) {
  const r = parseDatingRange(dating);
  return r ? r.min : null;
}

/** Ordinal century label for a Dating string, e.g. "14th"; "" if unparseable. */
export function parseCentury(dating) {
  const r = parseDatingRange(dating);
  if (!r) return "";
  const year = r.min;
  if (typeof year !== "number" || !Number.isFinite(year) || year < 1) return "";
  const cent = Math.floor((year - 1) / 100) + 1;
  return cent + "th";
}

// ---------------------------------------------------------------------------
// Lines (numeric range + text values)
// ---------------------------------------------------------------------------

/** Strip parenthetical comments: "1 (f. 8r)" -> "1". */
export function stripParenComments(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

/** Remove leading approximation markers: "ca. 30" -> "30". */
export function stripCaPrefix(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/^\s*(?:ca\.?|c\.)\s*/i, "").trim();
}

const _parseLinesRangeCache = new Map();

/** Parse a Lines value to {min, max}; null for text-only values. */
export function parseLinesRange(value) {
  if (value === null || value === undefined) return null;
  const key = String(value);
  if (_parseLinesRangeCache.has(key)) return _parseLinesRangeCache.get(key);

  let result = null;
  let s = stripParenComments(key);
  s = stripCaPrefix(s);
  if (s) {
    let m = s.match(/(\d{1,3})\s*[-–]\s*(\d{1,3})/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        result = { min: Math.min(a, b), max: Math.max(a, b) };
      }
    }
    if (!result) {
      m = s.match(/(\d{1,3})/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n)) result = { min: n, max: n };
      }
    }
  }

  _parseLinesRangeCache.set(key, result);
  return result;
}

/**
 * Text-only facet candidates for a Lines cell (the values that get checkboxes).
 * Numeric/range values yield none (they are covered by the range slider); "Empty"
 * and free-text values yield a single cleaned candidate.
 */
export function getLinesTextFacetCandidates(row) {
  const raw = getFacetValue(row, "Lines");
  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!s) return [];
  if (s === "Empty") return ["Empty"];
  const parsed = parseLinesRange(s);
  if (parsed) return [];
  const cleaned = stripCaPrefix(stripParenComments(s));
  return cleaned ? [cleaned] : [];
}

/** Canonical facet value for a Lines cell ("20-25", "30", or the raw text). */
export function normalizeLinesFacetValue(value) {
  const parsed = parseLinesRange(value);
  if (parsed) {
    if (parsed.min === parsed.max) return String(parsed.min);
    return `${parsed.min}-${parsed.max}`;
  }
  return value === null || value === undefined ? "" : String(value).trim();
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/** Facet value for a Columns cell, stripping parenthetical comments. */
export function normalizeColumnsFacetValue(value) {
  const s = value === null || value === undefined ? "" : String(value);
  const withoutParens = s.replace(/\s*\([^)]*\)/g, "");
  return withoutParens.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Multi-valued cells: Minor text and Production units
// ---------------------------------------------------------------------------

const _parseMinorTextTokensCache = new Map();

/** Split a Minor text cell into de-duplicated, first-seen labels. */
export function parseMinorTextTokens(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  if (_parseMinorTextTokensCache.has(raw)) return _parseMinorTextTokensCache.get(raw);
  if (!raw) {
    _parseMinorTextTokensCache.set(raw, []);
    return [];
  }

  const normalized = raw.replace(/\r/g, "").replace(/\n/g, ";");
  const parts = splitSemicolonList(normalized)
    .map((s) => String(s || "").trim())
    .filter((s) => s && s !== "." && s !== "-" && s !== "");

  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const k = normalizeForCompare(p);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  _parseMinorTextTokensCache.set(raw, out);
  return out;
}

/** Extract the distinct roman-numeral production units from a cell, uppercased. */
export function parseProductionUnitsCell(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  const normalized = raw.replace(/\r/g, "").replace(/\n/g, ";");
  const parts = splitSemicolonList(normalized)
    .map((s) => String(s || "").trim())
    .filter((s) => s && s !== "." && s !== "-" && s !== "");

  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const tokens = String(p).match(/\b[IVXLCDM]+\b/gi) || [];
    const candidates = tokens.length ? tokens : [p];
    for (const c of candidates) {
      const t = String(c || "").trim();
      if (!t) continue;
      if (!/^[IVXLCDM]+$/i.test(t)) continue;
      const norm = normalizeForCompare(t);
      if (!norm) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(t.toUpperCase());
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structural field normalizers
// ---------------------------------------------------------------------------

/** Normalize folio/page prefixes: "Ff.1r" -> "ff. 1r", "P.12" -> "p. 12". */
export function normalizeLeavesPages(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\b(f{1,2}|p{1,2})\.\s*/gi, (_m, grp) => `${String(grp).toLowerCase()}. `)
    .trim();
}

/** Collapse whitespace and re-segment gathering blocks. */
export function normalizeGatherings(value) {
  if (value === null || value === undefined) return "";
  let s = String(value).replace(/\r/g, "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\)\s+(?=[IVXLCDM]+:)/g, "); ");
  return s;
}

/** Normalize a Scribe cell to "; "-separated segments for repeated hand markers. */
export function normalizeScribe(value) {
  if (value === null || value === undefined) return "";
  let s = String(value).replace(/\r/g, "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, " ").trim();

  const markerRe = /(Hand\s+[A-Za-z]\b|Marginal:)/g;
  const matches = Array.from(s.matchAll(markerRe));
  if (matches.length <= 1) return s;

  const starts = matches
    .map((m) => (typeof m.index === "number" ? m.index : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (starts.length <= 1) return s;

  const parts = [];
  const prefix = s.slice(0, starts[0]).trim();
  if (prefix) parts.push(prefix.replace(/;+\s*$/g, "").trim());

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : s.length;
    let part = s.slice(start, end).trim();
    part = part.replace(/^;+\s*/g, "");
    part = part.replace(/;+\s*$/g, "").trim();
    if (part) parts.push(part);
  }

  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

export const LANGUAGE_MAP = {
  da: "Danish",
  is: "Icelandic",
  no: "Norwegian",
  sv: "Swedish",
};

/** Expand a row's ISO Language code to its display name, in place. */
export function normalizeRowLanguage(row) {
  if (row && row["Language"]) {
    const code = String(row["Language"]).toLowerCase();
    row["Language"] = LANGUAGE_MAP[code] || row["Language"];
  }
  return row;
}

// ---------------------------------------------------------------------------
// Facet fields + row-level facet value
// ---------------------------------------------------------------------------

export const FACET_FIELDS = [
  "Language",
  "Depository",
  "Object",
  "Material",
  "Size",
  "Production units",
  "Main text group",
  "Minor text",
  "Dating",
  "Script",
  "Pricking",
  "Ruling",
  "Columns",
  "Lines",
  "Rubric",
  "Style",
];

// Fields where an empty cell is a selectable "Empty" facet option.
export const FACET_EMPTY_LABEL_FIELDS = new Set([
  "Depository",
  "Object",
  "Material",
  "Size",
  "Script",
  "Pricking",
  "Ruling",
  "Columns",
  "Lines",
  "Rubric",
  "Style",
]);

/**
 * Row-level facet value for `field`. Empty-label fields map blanks to "Empty";
 * Columns is normalized. "Production units" is manuscript-scoped and is computed
 * by the model/facet layer from the grouped manuscript, not here.
 */
export function getFacetValue(row, field) {
  if (!row) return "";
  if (FACET_EMPTY_LABEL_FIELDS.has(field)) {
    const raw = row[field];
    const s = raw === null || raw === undefined ? "" : String(raw).trim();
    if (s === "") return "Empty";
    if (field === "Columns") {
      const normalized = normalizeColumnsFacetValue(s);
      return normalized === "" ? s : normalized;
    }
    return s;
  }
  return row[field];
}
