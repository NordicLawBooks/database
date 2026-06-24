// Pure string helpers shared across the app. No DOM, no globals.

/** HTML-escape a value for safe insertion as text/attribute content. */
export function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Normalize a value for equality comparison: trim, and treat a lone "." (an
 * Excel placeholder used in the sources) as empty.
 */
export function normalizeForCompare(val) {
  if (val === null || val === undefined) return "";
  const v = String(val).trim();
  return v === "." ? "" : v;
}

/** Split a "a; b; c" string into trimmed, non-empty tokens. */
export function splitSemicolonList(value) {
  return String(value || "")
    .split(/\s*;\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Turn arbitrary text into a token safe for use in a DOM id. */
export function toDomIdToken(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_");
}

// Letters with no canonical NFD diacritic decomposition, folded explicitly so
// search/compare is insensitive to Nordic orthography (þ/ð/æ/ø/œ/ß).
const FOLD_MAP = { "ð": "d", "þ": "th", "æ": "ae", "ø": "o", "œ": "oe", "ß": "ss" };

/**
 * Fold a string for accent-insensitive search/compare: lowercase, strip
 * combining diacritics (ö→o, í→i, á→a …), then map the Nordic letters that NFD
 * does not decompose. Used identically by the search index and the query parser
 * so the index and queries fold the same way.
 */
export function fold(value) {
  const s = value === null || value === undefined ? "" : String(value);
  let out;
  try {
    out = s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}+/gu, "");
  } catch {
    out = s.toLowerCase();
  }
  return out.replace(/[ðþæøœß]/gu, (c) => FOLD_MAP[c]);
}

/** Locale-aware, numeric, case-insensitive comparison for sorting facet values. */
export function compareValues(a, b) {
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
