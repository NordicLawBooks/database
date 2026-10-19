// Device preferences persisted to localStorage: column visibility, sidebar UI,
// and the last-used view + sort. Column visibility and UI are never part of the
// shareable URL; view/sort are, and a URL that names them always wins.

import { DEFAULT_SORT } from "./config.js";

const KEY = "nordiclaw.prefs";
const VIEWS = new Set(["merged", "table"]);
const SORTS = new Set(["shelfmark", "dating"]); // "relevance" only makes sense with a query

// Keys written by the legacy app (table.js), read once if no new prefs exist yet.
const LEGACY = {
  view: "nordiclaw.view",
  sort: "nordiclaw.mergedSort",
  facetsHidden: "nordiclaw.facetsHidden",
  tableColumns: "nordiclaw.tableColumns",
  mergedColumns: "nordiclaw.mergedColumns",
};

const defaultStorage = () => (typeof localStorage !== "undefined" ? localStorage : null);

function readColumns(storage, key) {
  try {
    const arr = JSON.parse(storage.getItem(key));
    return Array.isArray(arr) && arr.length ? arr.map(String) : undefined;
  } catch {
    return undefined;
  }
}

/** Build prefs from the legacy app's keys, or null if it left none. */
export function migrateLegacyPrefs(storage) {
  const view = storage.getItem(LEGACY.view);
  const sort = storage.getItem(LEGACY.sort);
  const hidden = storage.getItem(LEGACY.facetsHidden);
  const table = readColumns(storage, LEGACY.tableColumns);
  const merged = readColumns(storage, LEGACY.mergedColumns);
  if (view == null && sort == null && hidden == null && !table && !merged) return null;

  const out = {};
  if (view != null) out.view = view;
  if (sort != null) out.sort = sort;
  if (hidden != null) out.ui = { facetsHidden: hidden === "1" };
  if (table || merged) out.columns = { ...(merged && { merged }), ...(table && { table }) };
  return out;
}

/**
 * @returns {{columns?: {merged?: string[]|null, table?: string[]|null}, ui?: object,
 *            view?: string, sort?: string}}
 */
export function loadPrefs(storage = defaultStorage()) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : migrateLegacyPrefs(storage);
    if (!p || typeof p !== "object") return {};
    const out = {};
    if (p.columns && typeof p.columns === "object") out.columns = p.columns;
    if (p.ui && typeof p.ui === "object") out.ui = p.ui;
    if (VIEWS.has(p.view)) out.view = p.view;
    if (SORTS.has(p.sort)) out.sort = p.sort;
    return out;
  } catch {
    return {};
  }
}

export function savePrefs(state, storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.setItem(
      KEY,
      JSON.stringify({
        columns: state.columns,
        ui: state.ui,
        view: state.view,
        // Relevance is a per-search mode; remember the sort it stands in for.
        sort: SORTS.has(state.sort) ? state.sort : DEFAULT_SORT,
      })
    );
  } catch {
    /* storage unavailable; ignore */
  }
}

/** Apply the remembered view/sort to URL-decoded state, unless the URL names them. */
export function withRememberedViewSort(decoded, search, prefs) {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const out = { ...decoded };
  if (!params.has("v") && prefs.view) out.view = prefs.view;
  if (!params.has("sort") && prefs.sort) out.sort = prefs.sort;
  return out;
}
