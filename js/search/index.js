// Ranked, fuzzy, Nordic-aware free-text search via a vendored MiniSearch index.
//
// The index is row-level (one document per record), matching the row-level search
// contract: Text View filters individually-matching rows; Manuscript View keeps a
// manuscript when any of its rows match. The matcher returns a row predicate, so
// the existing pipeline and counts are unchanged.

import MiniSearch from "../vendor/minisearch.js";
import { fold } from "../util/text.js";
import { expandMainText, expandMinorText, mainCandidatesFrom } from "../model/expand.js";

const tokenize = (s) => String(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// All of a row's own (non-internal, non-derived) string values, for a catch-all
// "search everything" field — mirrors the legacy substring-over-all-fields scope.
const DERIVED = new Set(["Century", "DatingYear", "DatingMinYear", "DatingMaxYear", "Main text group"]);
function allText(row) {
  const parts = [];
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith("__") || DERIVED.has(k)) continue;
    if (v != null && v !== "") parts.push(String(v));
  }
  return parts.join(" ");
}

/**
 * Build a row-level MiniSearch index. Assigns a stable `__id` to each row.
 * If `maps` is provided, expanded Main/Minor text is indexed too, so a search
 * for an expansion (e.g. "Bergen") also matches its abbreviation.
 */
export function buildSearchIndex(rows, maps = null) {
  const index = new MiniSearch({
    idField: "id",
    fields: ["shelfmark", "name", "depository", "text"],
    processTerm: fold, // applied to both indexed terms and query terms
    tokenize,
    searchOptions: {
      prefix: true,
      fuzzy: (term) => term.length > 5 ? 0.2 : false,
      combineWith: "AND",
      boost: { shelfmark: 4, name: 3, depository: 2, text: 1 },
    },
  });

  const docs = rows.map((row, i) => {
    row.__id = i;
    let text = allText(row);
    if (maps) {
      const expanded = `${expandMainText(row["Main text"], maps)} ${expandMinorText(row["Minor text"], mainCandidatesFrom(row["Main text"]), maps)}`.trim();
      if (expanded) text += " " + expanded;
    }
    return {
      id: i,
      shelfmark: row["Shelf mark"] || "",
      name: row["Name"] || "",
      depository: `${row["Depository"] || ""} ${row["Depository_abbr"] || ""}`,
      text,
    };
  });
  index.addAll(docs);
  return index;
}

/**
 * Build a row predicate for the current query, or null when the query is empty.
 * @returns {((row: object) => boolean) | null}
 */
export function makeIndexMatcher(index, query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const ids = new Set(index.search(q).map((r) => r.id));
  return (row) => ids.has(row.__id);
}
