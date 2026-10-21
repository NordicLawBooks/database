// The single place the views get their data: facets + search -> results.
//
// The views share one facet engine, but keep distinct semantics: Manuscript
// View shows whole manuscripts where any row matches (and counts manuscripts);
// Production Unit View does the same per unit (and counts units); Text View
// shows individually-matching rows (and counts rows). The active view is taken
// from state.view.
//
// Sort "relevance" orders by search score (a manuscript or unit scores as its
// best row), ties broken by shelfmark; with no active query it is plain
// shelfmark order. "dating" orders units by their own earliest year.

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
  compareUnits,
} from "../model/manuscript.js";

/**
 * @param {{rows:object[], manuscripts:object[], units:object[], puByKey:Map}} model
 * @param {object} state
 * @param {{matchesQuery?:((row:object)=>boolean)|null, scoreOf?:((row:object)=>number)|null}} [opts]
 *   matchesQuery: row-level free-text predicate; null means no active query.
 *   Text View filters rows by it directly; Manuscript View keeps a manuscript
 *   (Production Unit View a unit) when any of its rows match.
 *   scoreOf: row relevance score, used when state.sort is "relevance".
 * @returns {{manuscripts:object[], units:object[], rows:object[], counts:object, totals:{manuscripts:number,rows:number,units?:number}}}
 *   units: Production Unit View's items (see makeUnit); only filled for that view.
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

  // Manuscript-scoped scoring and counting, over manuscripts or units alike.
  const sortByRelevance = (records) => {
    const best = new Map(records.map((rec) => [rec, Math.max(0, ...rec.rows.map(scoreOf))]));
    records.sort((a, b) => best.get(b) - best.get(a));
  };
  const matching = (records) =>
    records.filter((rec) => manuscriptMatchesFacets(rec, state, defs) && (!matchesQuery || rec.rows.some(matchesQuery)));
  const countsOver = (records) =>
    computeCounts(records, state, defs, { scope: "manuscript", puByKey: model.puByKey, matchesQuery });

  if (state.view === "units") {
    const units = matching(model.units).sort((a, b) => compareUnits(a, b, state.sort));
    if (byRelevance) sortByRelevance(units);
    const rows = units.flatMap((u) => u.rows);
    return {
      manuscripts: [...new Set(units.map((u) => u.ms))],
      units,
      rows,
      counts: countsOver(model.units),
      totals: { manuscripts: new Set(units.map((u) => u.key)).size, rows: rows.length, units: units.length },
    };
  }

  // Manuscript ("merged") view.
  const manuscripts = matching(model.manuscripts).sort((a, b) => compareManuscripts(a, b, state.sort));
  if (byRelevance) sortByRelevance(manuscripts);
  const rows = manuscripts.flatMap((ms) => ms.rows);
  return {
    manuscripts,
    units: [],
    rows,
    counts: countsOver(model.manuscripts),
    totals: { manuscripts: manuscripts.length, rows: rows.length },
  };
}
