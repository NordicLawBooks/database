// A tiny framework-free state store: the single source of truth.
//
// Everything else (URL, controls, facet checkboxes, both views) is a projection
// of this state. `set` applies a shallow top-level patch synchronously (so a
// following `get()` sees it) and notifies subscribers once per microtask, so a
// burst of updates (e.g. toggling several checkboxes) coalesces into one render.

import {
  FACET_KEYS,
  RANGE_KEYS,
  DEFAULT_VIEW,
  DEFAULT_SORT,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
} from "./config.js";

/** Build a fresh default state (fresh nested objects so stores never share refs). */
export function makeInitialState() {
  const facets = {};
  for (const k of FACET_KEYS) facets[k] = [];
  const ranges = {};
  for (const k of RANGE_KEYS) ranges[k] = { min: null, max: null };
  return {
    query: "",
    view: DEFAULT_VIEW,
    sort: DEFAULT_SORT,
    page: DEFAULT_PAGE,
    pageSize: DEFAULT_PAGE_SIZE,
    facets,
    ranges,
    columns: { merged: null, table: null }, // localStorage-backed; not in URL
    ui: { facetsHidden: false, sidebarWidth: 340 }, // localStorage-backed; not in URL
  };
}

/**
 * @param {object} [initial] starting state (defaults to makeInitialState()).
 * @returns {{ get(): object, set(patch, meta?): void, subscribe(fn): () => void }}
 *   - get(): current state (treat as immutable).
 *   - set(patch, meta): patch is a partial state object or `(state) => partial`.
 *     `meta` is passed through to subscribers (used for history intent:
 *     {history: "push" | "replace" | "silent"}).
 *   - subscribe(fn): fn(state, prevState, meta); returns an unsubscribe fn.
 */
export function createStore(initial = makeInitialState()) {
  let state = initial;
  let prev = initial;
  let pendingMeta = {};
  let scheduled = false;
  const listeners = new Set();

  function get() {
    return state;
  }

  function set(patch, meta = {}) {
    const partial = typeof patch === "function" ? patch(state) : patch;
    if (!partial) return;
    state = { ...state, ...partial };
    pendingMeta = meta; // last write in a batch wins (popstate sets aren't batched with user input)
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }

  function flush() {
    scheduled = false;
    const snapshot = state;
    const prevSnapshot = prev;
    const meta = pendingMeta;
    prev = state;
    pendingMeta = {};
    for (const fn of [...listeners]) fn(snapshot, prevSnapshot, meta);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { get, set, subscribe };
}
