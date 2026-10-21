// URL <-> state serialization, and the history glue.
//
// The URL mirrors the *shareable* slice of state (query, view, sort, page,
// pageSize, facets, ranges) so a search can be linked, bookmarked, and navigated
// with back/forward. Device preferences (columns, ui) are deliberately NOT in the
// URL. Only non-default values are written, so simple searches stay short.

import {
  FACET_KEYS,
  RANGE_KEYS,
  URL_ALIASES,
  DEFAULT_VIEW,
  defaultSortFor,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
} from "./config.js";

const VIEW_TO_CODE = { merged: "m", units: "u", table: "t" };
const CODE_TO_VIEW = { m: "merged", u: "units", t: "table" };

const facetUrlKey = (field) => "f." + (URL_ALIASES[field] || field);
const rangeUrlKey = (field) => field.toLowerCase(); // "Dating" -> "dating", "Lines" -> "lines"

function numOrNull(x) {
  if (x === "" || x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function parseRange(raw) {
  if (!raw) return null;
  const parts = String(raw).split("-");
  let min;
  let max;
  if (parts.length < 2) {
    const n = numOrNull(parts[0]);
    min = n;
    max = n;
  } else {
    min = numOrNull(parts[0]);
    max = numOrNull(parts[1]);
  }
  if (min === null && max === null) return null;
  return { min, max };
}

function parsePageSize(raw) {
  if (raw === "all") return "all";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PAGE_SIZE;
}

function parsePage(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_PAGE;
}

function emptyFacets() {
  const f = {};
  for (const k of FACET_KEYS) f[k] = [];
  return f;
}

function emptyRanges() {
  const r = {};
  for (const k of RANGE_KEYS) r[k] = { min: null, max: null };
  return r;
}

/**
 * Serialize the shareable slice of `state` to a query string (incl. leading "?",
 * or "" when everything is at its default). Omits defaults to keep URLs short.
 */
export function encodeState(state) {
  const p = new URLSearchParams();

  if (state.query) p.set("q", state.query);
  if (state.view && state.view !== DEFAULT_VIEW) p.set("v", VIEW_TO_CODE[state.view] || state.view);
  // The default sort depends on the query (Relevance while searching), so a plain
  // "?q=…" link opens ranked, and an explicit Shelfmark during a search is written out.
  if (state.sort && state.sort !== defaultSortFor(state.query)) p.set("sort", state.sort);
  if (state.page && state.page !== DEFAULT_PAGE) p.set("page", String(state.page));
  if (state.pageSize !== undefined && state.pageSize !== DEFAULT_PAGE_SIZE) {
    p.set("ps", String(state.pageSize));
  }

  for (const field of FACET_KEYS) {
    const vals = (state.facets && state.facets[field]) || [];
    if (!vals.length) continue;
    const key = facetUrlKey(field);
    for (const v of vals) p.append(key, v);
  }

  for (const field of RANGE_KEYS) {
    const r = state.ranges && state.ranges[field];
    if (!r || (r.min == null && r.max == null)) continue;
    p.set(rangeUrlKey(field), `${r.min ?? ""}-${r.max ?? ""}`);
  }

  const qs = p.toString();
  return qs ? "?" + qs : "";
}

/**
 * Parse a query string (or a `location`-like object with `.search`) into the
 * shareable slice of state. Always returns complete `facets`/`ranges` objects
 * (defaults for absent keys), so it can be shallow-merged onto any base state.
 * Tolerant: unknown keys and unparseable values are ignored.
 */
export function decodeState(input) {
  const raw =
    typeof input === "string" ? input : (input && input.search) || "";
  const qs = raw.startsWith("?") ? raw.slice(1) : raw;
  const p = new URLSearchParams(qs);

  const out = {
    query: p.get("q") || "",
    view: CODE_TO_VIEW[p.get("v")] || DEFAULT_VIEW,
    sort: p.get("sort") || defaultSortFor(p.get("q")),
    page: parsePage(p.get("page")),
    pageSize: p.has("ps") ? parsePageSize(p.get("ps")) : DEFAULT_PAGE_SIZE,
    facets: emptyFacets(),
    ranges: emptyRanges(),
  };

  for (const field of FACET_KEYS) {
    const vals = p.getAll(facetUrlKey(field));
    if (vals.length) out.facets[field] = vals.slice();
  }

  for (const field of RANGE_KEYS) {
    const r = parseRange(p.get(rangeUrlKey(field)));
    if (r) out.ranges[field] = r;
  }

  return out;
}

/**
 * Keep the URL in sync with the store and vice-versa.
 *
 * - Store change -> debounced URL write. `meta.history === "push"` uses
 *   pushState (discrete commits: facet toggle, view/sort/page change); otherwise
 *   replaceState (continuous edits: typing, range drag). `meta.history ===
 *   "silent"` suppresses the write (used by the popstate handler to avoid a loop).
 * - popstate -> store.set(decodeState(location), {history: "silent"}).
 *
 * DOM-dependent; pass a fake `window` (and `writeDelay: 0`) to test. Returns a
 * teardown function.
 */
export function startHistorySync(store, { window: win = globalThis, writeDelay = 150 } = {}) {
  const history = win && win.history;
  const loc = win && win.location;
  if (!history || !loc || typeof win.addEventListener !== "function") {
    return () => {};
  }

  let timer = null;
  const unsub = store.subscribe((state, _prev, meta) => {
    if (meta && meta.history === "silent") return;
    const push = meta && meta.history === "push";
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const url = encodeState(state) || loc.pathname || "?";
      if (push) history.pushState(null, "", url);
      else history.replaceState(null, "", url);
    }, writeDelay);
  });

  const onPopState = () => {
    store.set(decodeState(loc), { history: "silent" });
  };
  win.addEventListener("popstate", onPopState);

  return () => {
    unsub();
    win.removeEventListener("popstate", onPopState);
    if (timer) clearTimeout(timer);
  };
}
