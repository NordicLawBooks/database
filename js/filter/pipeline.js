// The single place both views get their data: facets + search -> results.
//
// Both views share one facet engine, but keep their faithful, distinct
// semantics: Manuscript View shows whole manuscripts where any row matches (and
// counts manuscripts); Text View shows individually-matching rows (and counts
// rows). The active view is taken from state.view.

import { FACET_DEFS } from "../config.js";
import {
  manuscriptMatchesFacets,
  rowMatchesFacets,
  computeCounts,
} from "../facets/engine.js";
import {
  getManuscriptKey,
  compareManuscripts,
  sortRowsForTextView,
} from "../model/manuscript.js";

/**
 * @param {{rows:object[], manuscripts:object[], puByKey:Map}} model
 * @param {object} state
 * @param {{matchesQuery?:((row:object)=>boolean)|null}} [opts]
 *   matchesQuery: row-level free-text predicate; null means no active query.
 *   Text View filters rows by it directly; Manuscript View keeps a manuscript
 *   when any of its rows match.
 * @returns {{manuscripts:object[], rows:object[], counts:object, totals:{manuscripts:number,rows:number}}}
 */
export function selectResults(model, state, { matchesQuery = null } = {}) {
  const defs = FACET_DEFS;

  if (state.view === "table") {
    let rows = model.rows.filter(
      (r) => rowMatchesFacets(r, state, defs, { puByKey: model.puByKey }) && (!matchesQuery || matchesQuery(r))
    );
    rows = sortRowsForTextView(rows, state.sort);

    const counts = computeCounts(model.rows, state, defs, {
      scope: "row",
      puByKey: model.puByKey,
      matchesQuery,
    });

    return {
      manuscripts: [],
      rows,
      counts,
      totals: { manuscripts: new Set(rows.map(getManuscriptKey)).size, rows: rows.length },
    };
  }

  // Manuscript ("merged") view.
  let manuscripts = model.manuscripts.filter(
    (ms) => manuscriptMatchesFacets(ms, state, defs) && (!matchesQuery || ms.rows.some(matchesQuery))
  );
  manuscripts = manuscripts.slice().sort((a, b) => compareManuscripts(a, b, state.sort));

  const rows = manuscripts.flatMap((ms) => ms.rows);
  const counts = computeCounts(model.manuscripts, state, defs, {
    scope: "manuscript",
    puByKey: model.puByKey,
    matchesQuery,
  });

  return {
    manuscripts,
    rows,
    counts,
    totals: { manuscripts: manuscripts.length, rows: rows.length },
  };
}
