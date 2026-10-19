// Top toolbar + pager: bind once, then reflect state on each render.

import { debounce } from "../util/debounce.js";
import { makeInitialState } from "../store.js";
import { DEFAULT_SORT } from "../config.js";

/**
 * Sort to use after the query changes: starting a search on the default sort
 * switches to "relevance"; clearing it switches "relevance" back to the default.
 * Any other explicit choice (e.g. "dating") is kept.
 */
export function sortAfterQueryChange(prevQuery, nextQuery, sort) {
  const had = String(prevQuery || "").trim() !== "";
  const has = String(nextQuery || "").trim() !== "";
  if (!had && has && sort === DEFAULT_SORT) return "relevance";
  if (had && !has && sort === "relevance") return DEFAULT_SORT;
  return sort;
}

/** Wire the toolbar and pager to the store. `refs` holds the DOM elements. */
export function bindControls(store, refs) {
  const applySearch = (value, history) => {
    const cur = store.get();
    if (value === cur.query) return;
    const sort = sortAfterQueryChange(cur.query, value, cur.sort);
    store.set({ query: value, sort, page: 1 }, { history });
  };
  // Typing searches as you go (debounced); the Search button and Enter apply
  // immediately and commit a history entry.
  const onSearch = debounce((value) => applySearch(value, "replace"), 150);
  refs.search?.addEventListener("input", (e) => onSearch(e.target.value));
  refs.search?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applySearch(refs.search.value, "push");
  });
  refs.searchButton?.addEventListener("click", () => applySearch(refs.search?.value ?? "", "push"));

  refs.viewSelect?.addEventListener("change", (e) => {
    store.set({ view: e.target.value, page: 1 }, { history: "push" });
  });

  refs.sortSelect?.addEventListener("change", (e) => {
    store.set({ sort: e.target.value, page: 1 }, { history: "push" });
  });

  refs.pageSizeSelect?.addEventListener("change", (e) => {
    const v = e.target.value;
    store.set({ pageSize: v === "all" ? "all" : Number(v), page: 1 }, { history: "push" });
  });

  refs.clearButton?.addEventListener("click", () => {
    const fresh = makeInitialState();
    const cur = store.get();
    store.set(
      {
        query: "",
        page: 1,
        facets: fresh.facets,
        ranges: fresh.ranges,
        view: cur.view,
        sort: sortAfterQueryChange(cur.query, "", cur.sort),
        pageSize: cur.pageSize,
      },
      { history: "push" }
    );
  });

  // Pager (delegated): buttons carry data-page="prev|next|first|last".
  refs.pager?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-page]");
    if (!btn || btn.disabled) return;
    const action = btn.dataset.page;
    const total = Number(refs.pager.dataset.totalPages || 1);
    const cur = store.get().page || 1;
    const next =
      action === "first" ? 1 : action === "last" ? total : action === "prev" ? cur - 1 : cur + 1;
    store.set({ page: Math.min(Math.max(1, next), total) }, { history: "push" });
  });
}

/** Pager text, as in the legacy app: "Page 2 / 5 — showing 20 of 87 manuscripts". */
export function pagerLabel(pageInfo, unit) {
  if (!pageInfo || !pageInfo.total) return "";
  const { page, totalPages, shown, total } = pageInfo;
  const showing = `showing ${shown} of ${total} ${unit}`;
  return totalPages > 1 ? `Page ${page} / ${totalPages} — ${showing}` : `S${showing.slice(1)}`;
}

/** Reflect current state + result metadata back into the toolbar and pager. */
export function renderControls(refs, state, result, pageInfo) {
  if (refs.search && document.activeElement !== refs.search && refs.search.value !== state.query) {
    refs.search.value = state.query;
  }
  if (refs.viewSelect) refs.viewSelect.value = state.view;
  if (refs.sortSelect) refs.sortSelect.value = state.sort;
  if (refs.pageSizeSelect) refs.pageSizeSelect.value = String(state.pageSize);

  if (refs.meta) {
    refs.meta.textContent = `${result.totals.manuscripts} manuscripts · ${result.totals.rows} texts`;
  }

  if (refs.pager) {
    const label = pagerLabel(pageInfo, state.view === "table" ? "texts" : "manuscripts");
    if (pageInfo && pageInfo.totalPages > 1) {
      refs.pager.dataset.totalPages = String(pageInfo.totalPages);
      const { page, totalPages } = pageInfo;
      refs.pager.innerHTML =
        `<button class="btn btn-sm btn-outline-secondary" data-page="prev" ${page <= 1 ? "disabled" : ""}>‹ Prev</button>` +
        `<span class="mx-2 small text-secondary">${label}</span>` +
        `<button class="btn btn-sm btn-outline-secondary" data-page="next" ${page >= totalPages ? "disabled" : ""}>Next ›</button>`;
    } else {
      refs.pager.innerHTML = label ? `<span class="small text-secondary">${label}</span>` : "";
    }
  }
}
