// Config-driven facet matching and counting.
//
// One per-facet/per-row predicate (`fieldMatchesRow`) is reused for both views:
// Text View tests each row directly; Manuscript View tests `rows.some(...)`.
// This removes the per-field branching that was duplicated across the legacy
// filter and count functions, while preserving each view's exact semantics.

import { normalizeForCompare } from "../util/text.js";
import {
  getFacetValue,
  parseMinorTextTokens,
  parseLinesRange,
  normalizeLinesFacetValue,
  stripParenComments,
  stripCaPrefix,
  getLinesTextFacetCandidates,
} from "../model/fields.js";
import {
  getManuscriptKey,
  mainTextGroupVariantKey,
  mainTextVariant,
  getProductionUnitsFacetValueForManuscript,
} from "../model/manuscript.js";

const VARIANT_KEY = "Main text group-variant";

function normRange(r) {
  let min = r ? r.min : null;
  let max = r ? r.max : null;
  if (typeof min === "number" && Number.isNaN(min)) min = null;
  if (typeof max === "number" && Number.isNaN(max)) max = null;
  if (min !== null && max !== null && min > max) {
    const t = min;
    min = max;
    max = t;
  }
  return { min, max };
}

/** Is this facet currently constraining results (does it have an active selection)? */
export function isFacetActive(def, state) {
  switch (def.type) {
    case "range": {
      const { min, max } = normRange(state.ranges[def.field]);
      return min !== null || max !== null;
    }
    case "range+terms": {
      const { min, max } = normRange(state.ranges[def.field]);
      const text = state.facets[def.field] || [];
      return min !== null || max !== null || text.length > 0;
    }
    case "hierarchical": {
      const variant = state.facets[def.childField] || [];
      const group = state.facets[def.field] || [];
      return variant.length > 0 || group.length > 0;
    }
    default: {
      const sel = state.facets[def.field] || [];
      return sel.length > 0;
    }
  }
}

/**
 * Does a single row satisfy `def`'s active selection? Assumes the facet is
 * active (callers gate with isFacetActive). `ctx.puByKey` resolves the
 * manuscript-scoped Production units value for the row's manuscript.
 */
export function fieldMatchesRow(def, row, state, ctx = {}) {
  switch (def.type) {
    case "term": {
      const sel = state.facets[def.field] || [];
      let val;
      if (def.scope === "manuscript") {
        val = ctx.puByKey ? ctx.puByKey.get(getManuscriptKey(row)) : undefined;
        if (val === undefined || val === null) val = "Empty";
      } else {
        val = getFacetValue(row, def.field);
      }
      return sel.includes(val);
    }
    case "multi": {
      const sel = state.facets[def.field] || [];
      const selNorm = new Set(sel.map((s) => normalizeForCompare(s)));
      for (const t of parseMinorTextTokens(row && row[def.field])) {
        if (selNorm.has(normalizeForCompare(t))) return true;
      }
      return false;
    }
    case "hierarchical": {
      const variant = state.facets[def.childField] || [];
      if (variant.length > 0) {
        return variant.includes(mainTextGroupVariantKey(row));
      }
      const group = state.facets[def.field] || [];
      return group.includes(getFacetValue(row, def.field));
    }
    case "range": {
      const { min, max } = normRange(state.ranges[def.field]);
      const yMin = row[def.minField];
      const yMax = row[def.maxField];
      if (typeof yMin !== "number" || Number.isNaN(yMin)) return false;
      if (typeof yMax !== "number" || Number.isNaN(yMax)) return false;
      if (min !== null && yMax < min) return false;
      if (max !== null && yMin > max) return false;
      return true;
    }
    case "range+terms": {
      const { min, max } = normRange(state.ranges[def.field]);
      const selectedText = state.facets[def.field] || [];
      const rangeActive = min !== null || max !== null;
      if (selectedText.length > 0) {
        const v = normalizeLinesFacetValue(getFacetValue(row, def.field));
        if (selectedText.includes(v)) return true;
        const cleaned = stripCaPrefix(stripParenComments(getFacetValue(row, def.field)));
        if (cleaned && selectedText.includes(cleaned)) return true;
      }
      if (!rangeActive) return false;
      const parsed = parseLinesRange(row[def.field]);
      if (!parsed) return false;
      if (min !== null && parsed.min < min) return false;
      if (max !== null && parsed.max > max) return false;
      return true;
    }
    default:
      return true;
  }
}

/** Does a manuscript satisfy all active facets? (per-field "any row matches".) */
export function manuscriptMatchesFacets(ms, state, defs) {
  for (const def of defs) {
    if (!isFacetActive(def, state)) continue;
    if (def.type === "term" && def.scope === "manuscript") {
      const sel = state.facets[def.field] || [];
      const v = ms.puValue !== undefined ? ms.puValue : getProductionUnitsFacetValueForManuscript(ms);
      if (!sel.includes(v)) return false;
      continue;
    }
    let ok = false;
    for (const r of ms.rows) {
      if (fieldMatchesRow(def, r, state)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }
  return true;
}

/** Does a single row satisfy all active facets? (Text View semantics.) */
export function rowMatchesFacets(row, state, defs, ctx = {}) {
  for (const def of defs) {
    if (!isFacetActive(def, state)) continue;
    if (!fieldMatchesRow(def, row, state, ctx)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);

function queryOk(rec, scope, matchesQuery) {
  if (!matchesQuery) return true;
  return scope === "manuscript" ? rec.rows.some(matchesQuery) : matchesQuery(rec);
}

function bucketCounts(key, base, scope, puByKey) {
  const counts = new Map();

  if (key === "Lines") {
    if (scope === "manuscript") {
      for (const ms of base) {
        const seen = new Set();
        for (const r of ms.rows) for (const c of getLinesTextFacetCandidates(r)) seen.add(c);
        for (const v of seen) inc(counts, v);
      }
    } else {
      for (const r of base) for (const c of getLinesTextFacetCandidates(r)) inc(counts, c);
    }
  } else if (key === "Production units") {
    if (scope === "manuscript") {
      for (const ms of base) inc(counts, ms.puValue);
    } else {
      const byMs = new Map();
      for (const r of base) {
        const k = getManuscriptKey(r);
        if (!byMs.has(k)) byMs.set(k, r);
      }
      for (const r of byMs.values()) {
        const s = String((puByKey && puByKey.get(getManuscriptKey(r))) || "").trim();
        if (s) inc(counts, s);
      }
    }
  } else if (key === "Minor text") {
    if (scope === "manuscript") {
      for (const ms of base) {
        const byNorm = new Map();
        for (const r of ms.rows) {
          for (const t of parseMinorTextTokens(r && r["Minor text"])) {
            const nk = normalizeForCompare(t);
            if (nk && !byNorm.has(nk)) byNorm.set(nk, t);
          }
        }
        for (const t of byNorm.values()) inc(counts, t);
      }
    } else {
      for (const r of base) for (const t of parseMinorTextTokens(r && r["Minor text"])) inc(counts, t);
    }
  } else if (key === "Main text group") {
    if (scope === "manuscript") {
      for (const ms of base) {
        const seen = new Set();
        for (const r of ms.rows) {
          const g = r["Main text group"] || "";
          if (g) seen.add(g);
        }
        for (const v of seen) inc(counts, v);
      }
    } else {
      for (const r of base) {
        const g = r["Main text group"] || "";
        if (g) inc(counts, g);
      }
    }
  } else if (key === VARIANT_KEY) {
    const variantKey = (r) => {
      const g = r["Main text group"] || "";
      const variant = mainTextVariant(r);
      return g && variant ? g + "|" + variant : "";
    };
    if (scope === "manuscript") {
      for (const ms of base) {
        const seen = new Set();
        for (const r of ms.rows) {
          const k = variantKey(r);
          if (k) seen.add(k);
        }
        for (const v of seen) inc(counts, v);
      }
    } else {
      for (const r of base) {
        const k = variantKey(r);
        if (k) inc(counts, k);
      }
    }
  } else if (key !== "Dating") {
    if (scope === "manuscript") {
      for (const ms of base) {
        const seen = new Set();
        for (const r of ms.rows) {
          const v = getFacetValue(r, key);
          if (v === null || v === undefined) continue;
          const s = String(v).trim();
          if (s) seen.add(s);
        }
        for (const v of seen) inc(counts, v);
      }
    } else {
      for (const r of base) {
        const v = getFacetValue(r, key);
        if (v === null || v === undefined) continue;
        const s = String(v).trim();
        if (s) inc(counts, s);
      }
    }
  }

  return counts;
}

/**
 * Per-option facet counts. Each facet F is counted over records matching every
 * OTHER active facet (and the query), so a facet's own selection never shrinks
 * its sibling option counts.
 *
 * @param {object[]} records  rows (scope "row") or manuscripts (scope "manuscript").
 * @param {object} state
 * @param {object[]} defs     FACET_DEFS.
 * @param {{scope:"row"|"manuscript", puByKey?:Map, searchKeys?:Set|null}} opts
 * @returns {Record<string,{baseTotal:number, counts:Map<string,number>}>}
 */
export function computeCounts(records, state, defs, { scope, puByKey = null, matchesQuery = null } = {}) {
  const countKeys = [...defs.map((d) => d.field), VARIANT_KEY];
  const out = {};

  for (const key of countKeys) {
    const excludeKey = key === VARIANT_KEY ? "Main text group" : key;
    const defsExcept = defs.filter((d) => d.field !== excludeKey);

    const base = records.filter((rec) => {
      const pass =
        scope === "manuscript"
          ? manuscriptMatchesFacets(rec, state, defsExcept)
          : rowMatchesFacets(rec, state, defsExcept, { puByKey });
      return pass && queryOk(rec, scope, matchesQuery);
    });

    const baseTotal =
      scope === "manuscript"
        ? base.length
        : key === "Production units"
          ? new Set(base.map(getManuscriptKey)).size
          : base.length;

    out[key] = { baseTotal, counts: bucketCounts(key, base, scope, puByKey) };
  }

  return out;
}
