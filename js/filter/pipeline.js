// The single place both views get their data: facets + search -> results.
//
// Both views share one facet engine, but keep their faithful, distinct
// semantics: Manuscript View shows whole manuscripts where any row matches (and
// counts manuscripts); Text View shows individually-matching rows (and counts
// rows). The active view is taken from state.view.
//
// Sort "relevance" orders by search score (a manuscript scores as its best row),
// ties broken by shelfmark; with no active query it is plain shelfmark order.

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
  listUnits,
} from "../model/manuscript.js";

/**
 * @param {{rows:object[], manuscripts:object[], puByKey:Map}} model
 * @param {object} state
 * @param {{matchesQuery?:((row:object)=>boolean)|null, scoreOf?:((row:object)=>number)|null}} [opts]
 *   matchesQuery: row-level free-text predicate; null means no active query.
 *   Text View filters rows by it directly; Manuscript View keeps a manuscript
 *   when any of its rows match.
 *   scoreOf: row relevance score, used when state.sort is "relevance".
 * @returns {{manuscripts:object[], units:object[], rows:object[], counts:object, totals:{manuscripts:number,rows:number}}}
 *   units: Production Unit View's {ms, run} items (only filled for that view).
 */
export function selectResults(model, state, { matchesQuery = null, scoreOf = null } = {}) {
  const defs = FACET_DEFS;
  const byRelevance = state.sort === "relevance" && matchesQuery && scoreOf;

  if (state.view === "table") {
    let rows = model.rows.filter(
      (r) => rowMatchesFacets(r, state, defs, { puByKey: model.puByKey }) && (!matchesQuery || matchesQuery(r))
    );
    rows = sortRowsForTextView(rows, state.sort);
    // Stable sort: equal scores keep the shelfmark order from above.
    if (byRelevance) rows.sort((a, b) => scoreOf(b) - scoreOf(a));

    const counts = computeCounts(model.rows, state, defs, {
      scope: "row",
      puByKey: model.puByKey,
      matchesQuery,
    });

    return {
      manuscripts: [],
      units: [],
      rows,
      counts,
      totals: { manuscripts: new Set(rows.map(getManuscriptKey)).size, rows: rows.length },
    };
  }

  // Manuscript ("merged") and Production Unit ("units") views.
  let manuscripts = model.manuscripts.filter(
    (ms) => manuscriptMatchesFacets(ms, state, defs) && (!matchesQuery || ms.rows.some(matchesQuery))
  );
  manuscripts = manuscripts.slice().sort((a, b) => compareManuscripts(a, b, state.sort));
  if (byRelevance) {
    const best = new Map(manuscripts.map((ms) => [ms, Math.max(0, ...ms.rows.map(scoreOf))]));
    manuscripts.sort((a, b) => best.get(b) - best.get(a));
  }

  const rows = manuscripts.flatMap((ms) => ms.rows);
  const counts = computeCounts(model.manuscripts, state, defs, {
    scope: "manuscript",
    puByKey: model.puByKey,
    matchesQuery,
  });

  return {
    manuscripts,
    units: state.view === "units" ? listUnits(manuscripts, model.unitsByKey, state.sort) : [],
    rows,
    counts,
    totals: { manuscripts: manuscripts.length, rows: rows.length },
  };
}
