// Manuscript grouping, row enrichment, and ordering.
//
// A "manuscript" is a consecutive run of rows sharing the same Shelf mark
// (keyed by Depository + Shelf mark). Manuscript-level facet values (e.g.
// Production units) are derived here so both the row and manuscript code paths
// resolve them consistently.

import { normalizeForCompare } from "../util/text.js";
import {
  parseDatingRange,
  parseCentury,
  parseProductionUnitsCell,
  normalizeRowLanguage,
} from "./fields.js";

/** Composite manuscript key: Depository (abbr if present) + "||" + Shelf mark. */
export function getManuscriptKey(row) {
  const dep = normalizeForCompare(row["Depository_abbr"] || row["Depository"]);
  const shelf = normalizeForCompare(row["Shelf mark"]);
  return dep + "||" + shelf;
}

/** Group rows into [{key, rows}], preserving first-seen order. */
export function groupByManuscript(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = getManuscriptKey(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return Array.from(map.entries()).map(([key, groupRows]) => ({ key, rows: groupRows }));
}

/** The variant inside a Main text cell: "Code (Variant)" -> "Variant". */
export function mainTextVariant(row) {
  const mt = row && row["Main text"] ? String(row["Main text"]) : "";
  if (!mt) return "";
  const m = mt.match(/^([^(]+)\s*\(([^)]+)\)/);
  return m ? m[2].trim() : "";
}

/** Composite "group|variant" key used by the hierarchical Main text facet. */
export function mainTextGroupVariantKey(row) {
  const group = (row && row["Main text group"]) || "";
  return group + "|" + mainTextVariant(row);
}

/**
 * Add map-free derived fields to a row in place: Main text group, Dating-derived
 * years, Century, and the expanded Language. (Depository expansion and
 * Leaves/Pages normalization happen at load time, where the lookup maps live.)
 */
export function enrichRow(row) {
  const mt = row["Main text"] ? String(row["Main text"]) : "";
  if (mt) {
    const m = mt.match(/^([^(]+)\s*\(/);
    row["Main text group"] = m ? m[1].trim() : mt;
  } else {
    row["Main text group"] = "";
  }

  const dr = parseDatingRange(row["Dating"]);
  row["DatingMinYear"] = dr ? dr.min : null;
  row["DatingMaxYear"] = dr ? dr.max : null;
  row["DatingYear"] = dr ? dr.min : null;
  row["Century"] = parseCentury(row["Dating"]);

  normalizeRowLanguage(row);
  return row;
}

function isExplicitUnknownValue(value) {
  const s = value === null || value === undefined ? "" : String(value).trim();
  return s.toLowerCase() === "unknown";
}

/** Number of distinct roman-numeral production units across a manuscript's rows. */
export function getProductionUnitsCountForManuscript(ms) {
  if (!ms || !Array.isArray(ms.rows)) return 0;
  const seen = new Set();
  for (const r of ms.rows) {
    for (const u of parseProductionUnitsCell(r && r["Production Unit"])) {
      const k = normalizeForCompare(u);
      if (k) seen.add(k);
    }
  }
  return seen.size;
}

/**
 * Manuscript-level Production units facet value: "Unknown" if any row says so,
 * else the distinct unit count as a string, else "Empty".
 */
export function getProductionUnitsFacetValueForManuscript(ms) {
  if (!ms || !Array.isArray(ms.rows)) return "Empty";
  for (const r of ms.rows) {
    if (isExplicitUnknownValue(r && r["Production Unit"])) return "Unknown";
  }
  const n = getProductionUnitsCountForManuscript(ms);
  return n > 0 ? String(n) : "Empty";
}

/**
 * Build the in-memory model from parsed rows: enrich rows, group into
 * manuscripts, and attach each manuscript's Production units value.
 * @returns {{rows: object[], manuscripts: Array<{key,rows,puValue}>, puByKey: Map<string,string>, units: object[]}}
 */
export function buildModel(rows) {
  const enriched = (rows || []).map(enrichRow);
  const manuscripts = groupByManuscript(enriched);
  const puByKey = new Map();
  for (const ms of manuscripts) {
    ms.puValue = getProductionUnitsFacetValueForManuscript(ms);
    puByKey.set(ms.key, ms.puValue);
  }
  return { rows: enriched, manuscripts, puByKey, units: buildUnits(manuscripts) };
}

// ---------------------------------------------------------------------------
// Helpers for merged-cell rendering (heuristic fallback + manuscript-level fields)
// ---------------------------------------------------------------------------

/** Columns whose value is constant across all the given rows (ignoring `excluded`). */
export function getConstantFields(rows, columns, excluded = []) {
  const excludedSet = new Set(excluded);
  const constant = new Set();
  for (const col of columns) {
    if (excludedSet.has(col)) continue;
    const values = new Set(rows.map((r) => normalizeForCompare(r[col])));
    if (values.size <= 1) constant.add(col);
  }
  return constant;
}

/**
 * Split a manuscript's rows into contiguous Production Unit runs. A blank cell
 * continues the run above it (the raw export leaves merged cells blank).
 * @returns {Array<{start:number, end:number, raw:string}>} inclusive row ranges;
 *   `raw` is the cell text that opened the run ("" if the first rows are blank).
 */
export function productionUnitRuns(rows) {
  const runs = [];
  let lastKey = "";
  for (let i = 0; i < (rows || []).length; i++) {
    const raw = rows[i] ? rows[i]["Production Unit"] : "";
    const key = normalizeForCompare(raw);
    if (i === 0 || (key && key !== lastKey)) {
      if (runs.length) runs[runs.length - 1].end = i - 1;
      runs.push({ start: i, end: i, raw: key ? String(raw) : "" });
      lastKey = key;
    }
  }
  if (runs.length) runs[runs.length - 1].end = rows.length - 1;
  return runs;
}

/**
 * productionUnitRuns plus each run's earliest Dating year (null if undated).
 * `rows` must have merged cells filled down, so every row carries its Dating.
 */
export function productionUnitsWithDating(rows) {
  return productionUnitRuns(rows).map((run) => {
    const years = [];
    for (let i = run.start; i <= run.end; i++) {
      const dr = parseDatingRange(rows[i]["Dating"]);
      if (dr && typeof dr.min === "number") years.push(dr.min);
    }
    return { ...run, minYear: years.length ? Math.min(...years) : null };
  });
}

/**
 * A Production Unit View record. Shaped like a manuscript ({key, rows, puValue})
 * so the facet engine matches and counts units exactly as it does manuscripts.
 * `run` indexes the rows the view renders; `rows` are the unit's model rows.
 */
export function makeUnit(ms, run, rows) {
  return { key: ms.key, ms, run, rows, puValue: ms.puValue };
}

/** Units built straight from model rows (used when no raw rows exist, e.g. in tests). */
export function buildUnits(manuscripts) {
  return manuscripts.flatMap((ms) =>
    productionUnitsWithDating(ms.rows).map((run) => makeUnit(ms, run, ms.rows.slice(run.start, run.end + 1)))
  );
}

/**
 * Order units: by their own earliest year (undated last) when sortMode is
 * "dating"; then by manuscript shelfmark order, then position in the manuscript.
 */
export function compareUnits(a, b, sortMode) {
  if (sortMode === "dating") {
    const ya = a.run.minYear === null ? Number.POSITIVE_INFINITY : a.run.minYear;
    const yb = b.run.minYear === null ? Number.POSITIVE_INFINITY : b.run.minYear;
    if (ya !== yb) return ya - yb;
  }
  return compareManuscripts(a.ms, b.ms, "shelfmark") || a.run.start - b.run.start;
}

/** Display label for a Production Unit cell: "I, II", "Unknown", or "Empty". */
export function productionUnitLabel(raw) {
  if (isExplicitUnknownValue(raw)) return "Unknown";
  const tokens = parseProductionUnitsCell(raw);
  return tokens.length ? tokens.join(", ") : "Empty";
}

/** Join the non-empty values of `field` across rows. */
export function aggregateFieldValues(rows, field, separator = "; ") {
  const parts = [];
  for (const r of rows || []) {
    if (!r) continue;
    const v = normalizeForCompare(r[field]);
    if (v) parts.push(v);
  }
  return parts.join(separator);
}

/** The nearest non-empty value of `field` at or above `rowIndex` (for merged cells). */
export function getEffectiveValue(rows, rowIndex, field) {
  if (!Array.isArray(rows)) return "";
  for (let i = rowIndex; i >= 0; i--) {
    const v = normalizeForCompare(rows[i] && rows[i][field]);
    if (v) return v;
  }
  return "";
}

/** True when `field` is empty for every row. */
export function allFieldValuesEmpty(rows, field) {
  for (const r of rows || []) {
    if (r && normalizeForCompare(r[field])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

function compareText(a, b) {
  const ax = normalizeForCompare(a);
  const bx = normalizeForCompare(b);
  return ax.localeCompare(bx, undefined, { numeric: true, sensitivity: "base" });
}

/** Order manuscripts by earliest dating (when sortMode==="dating"), then Depository, Shelf mark. */
export function compareManuscripts(msA, msB, sortMode) {
  const aRows = msA && Array.isArray(msA.rows) ? msA.rows : [];
  const bRows = msB && Array.isArray(msB.rows) ? msB.rows : [];
  const a0 = aRows[0] || {};
  const b0 = bRows[0] || {};

  const aDep = normalizeForCompare(a0["Depository_abbr"] || a0["Depository"] || "");
  const bDep = normalizeForCompare(b0["Depository_abbr"] || b0["Depository"] || "");
  const aShelf = normalizeForCompare(a0["Shelf mark"] || "");
  const bShelf = normalizeForCompare(b0["Shelf mark"] || "");

  if (sortMode === "dating") {
    const yearsA = aRows.map((r) => r["DatingYear"]).filter((y) => typeof y === "number" && !Number.isNaN(y));
    const yearsB = bRows.map((r) => r["DatingYear"]).filter((y) => typeof y === "number" && !Number.isNaN(y));
    const minA = yearsA.length ? Math.min(...yearsA) : Number.POSITIVE_INFINITY;
    const minB = yearsB.length ? Math.min(...yearsB) : Number.POSITIVE_INFINITY;
    if (minA !== minB) return minA - minB;
  }

  const depCmp = compareText(aDep, bDep);
  if (depCmp) return depCmp;
  return compareText(aShelf, bShelf);
}

/** Order flat rows for Text View: dating (optional), then Depository, Shelf mark, stable. */
export function sortRowsForTextView(rows, sortMode) {
  const decorated = (Array.isArray(rows) ? rows : []).map((r, idx) => ({ r, idx }));
  decorated.sort((a, b) => {
    const ra = a.r || {};
    const rb = b.r || {};
    if (sortMode === "dating") {
      const ay = typeof ra["DatingYear"] === "number" && !Number.isNaN(ra["DatingYear"]) ? ra["DatingYear"] : Number.POSITIVE_INFINITY;
      const by = typeof rb["DatingYear"] === "number" && !Number.isNaN(rb["DatingYear"]) ? rb["DatingYear"] : Number.POSITIVE_INFINITY;
      if (ay !== by) return ay - by;
    }
    const depCmp = compareText(ra["Depository_abbr"] || ra["Depository"] || "", rb["Depository_abbr"] || rb["Depository"] || "");
    if (depCmp) return depCmp;
    const shelfCmp = compareText(ra["Shelf mark"] || "", rb["Shelf mark"] || "");
    if (shelfCmp) return shelfCmp;
    return a.idx - b.idx;
  });
  return decorated.map((x) => x.r);
}
