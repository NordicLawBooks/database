// Column-visibility selector: preset buttons, a filter box, and per-column
// checkboxes. The visible set is stored per view in state.columns ({merged,
// table}); null means "all columns". Production Unit View shares Manuscript
// View's set, as both are grouped views of the same rows.

import { escapeHtml, toDomIdToken } from "../util/text.js";
import { COLUMN_PRESET_BUTTONS, DEFAULT_COLUMN_PRESET, getPreset, columnTitle as colTitle } from "../config.js";

const viewKey = (state) => (state.view === "table" ? "table" : "merged");

/** The visible columns for the active view (in `allColumns` order). */
export function visibleColumns(allColumns, state) {
  const sel = state.columns && state.columns[viewKey(state)];
  if (!Array.isArray(sel)) return allColumns; // null => all
  const set = new Set(sel);
  const vis = allColumns.filter((c) => set.has(c));
  return vis.length ? vis : allColumns; // never hide everything
}

/** Build the menu (preset buttons + filter + checkbox list) once. */
export function buildColumnsMenu(host, allColumns) {
  const buttons = COLUMN_PRESET_BUTTONS.map(
    (b) => `<button type="button" class="btn btn-sm btn-outline-secondary" data-cols-action="${b.action}">${escapeHtml(b.label)}</button>`
  ).join("");
  const list = allColumns
    .map((c) => {
      const id = `col_${toDomIdToken(c)}`;
      return `<div class="form-check" data-col-item><input type="checkbox" class="form-check-input" data-col="${escapeHtml(c)}" id="${id}"><label class="form-check-label" for="${id}">${escapeHtml(colTitle(c))}</label></div>`;
    })
    .join("");
  host.innerHTML =
    `<div class="d-flex flex-wrap gap-1 mb-2">${buttons}</div>` +
    `<input type="text" class="form-control form-control-sm mb-2" placeholder="Filter columns…" data-cols-filter>` +
    `<div data-cols-list>${list}</div>`;
}

/** Reflect the active view's visibility into the checkboxes. */
export function syncColumnsMenu(host, allColumns, state) {
  const vis = new Set(visibleColumns(allColumns, state));
  for (const cb of host.querySelectorAll("input[data-col]")) cb.checked = vis.has(cb.dataset.col);
}

/** Wire preset buttons, the filter box, and per-column toggles to the store. */
export function bindColumnsMenu(host, store, allColumns) {
  const setCols = (value) => {
    const state = store.get();
    store.set({ columns: { ...state.columns, [viewKey(state)]: value } }, { history: "replace" });
  };

  host.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-cols-action]");
    if (!btn) return;
    const action = btn.dataset.colsAction;
    if (action === "all") setCols(null);
    else if (action === "reset") setCols(getPreset(DEFAULT_COLUMN_PRESET, allColumns));
    else setCols(getPreset(action, allColumns));
  });

  host.addEventListener("change", (e) => {
    const t = e.target;
    if (!t.matches("input[data-col]")) return;
    const state = store.get();
    const current = new Set(visibleColumns(allColumns, state));
    if (t.checked) current.add(t.dataset.col);
    else current.delete(t.dataset.col);
    setCols(allColumns.filter((c) => current.has(c)));
  });

  host.addEventListener("input", (e) => {
    if (!e.target.matches("[data-cols-filter]")) return;
    const q = e.target.value.toLowerCase();
    for (const item of host.querySelectorAll("[data-col-item]")) {
      item.style.display = !q || item.textContent.toLowerCase().includes(q) ? "" : "none";
    }
  });
}
