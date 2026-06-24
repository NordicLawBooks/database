// Temporary free-text search: a row-level, folded (Nordic-aware) substring match
// over all of a row's values. Returns a predicate (row -> bool), or null when the
// query is empty. The pipeline applies it per-row in Text View and via
// `rows.some(...)` per-manuscript in Manuscript View — matching legacy behavior.
// A later step swaps in a ranked, fuzzy MiniSearch index.

import { fold } from "../util/text.js";

/**
 * @returns {((row: object) => boolean) | null}
 */
export function makeQueryMatcher(query) {
  const q = fold(query).trim();
  if (!q) return null;
  return (row) => {
    for (const v of Object.values(row)) {
      if (v != null && fold(v).includes(q)) return true;
    }
    return false;
  };
}
