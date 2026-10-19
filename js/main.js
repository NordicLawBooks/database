// Composition root: load data, seed the store from the URL, wire the facet
// sidebar + toolbar + views, and keep everything in sync via the store.

import { createStore, makeInitialState } from "./store.js";
import { decodeState, startHistorySync } from "./url.js";
import { FACET_DEFS, DEFAULT_COLUMN_PRESET, getPreset } from "./config.js";
import { loadModel } from "./data/load.js";
import { loadSegments } from "./data/segments.js";
import { loadDepositoryMap, loadExpansionMaps } from "./data/lookups.js";
import { openManuscriptModal } from "./render/ms-modal.js";
import { openRowModal } from "./render/row-modal.js";
import { exportManuscriptPdf, exportRowDetailsPdf } from "./pdf/export.js";
import { computeCounts } from "./facets/engine.js";
import { selectResults } from "./filter/pipeline.js";
import { buildFacetSidebar, syncFacetSidebar, bindFacetEvents } from "./facets/render.js";
import { renderTextTable, displayColumns } from "./render/text-table.js";
import { renderManuscriptView } from "./render/manuscript-view.js";
import { buildColumnsMenu, syncColumnsMenu, bindColumnsMenu, visibleColumns } from "./render/columns.js";
import { bindControls, renderControls } from "./render/controls.js";
import { buildSearchIndex, makeIndexQuery } from "./search/index.js";
import { loadPrefs, savePrefs } from "./prefs.js";

async function main() {
  const refs = {
    search: document.getElementById("search"),
    viewSelect: document.getElementById("view-select"),
    sortSelect: document.getElementById("sort-select"),
    pageSizeSelect: document.getElementById("page-size-select"),
    clearButton: document.getElementById("clear-filters"),
    meta: document.getElementById("result-meta"),
    pager: document.getElementById("pager"),
    sidebar: document.getElementById("facet-sidebar"),
    tableView: document.getElementById("table-view"),
    mergedView: document.getElementById("merged-view"),
    columnsMenu: document.getElementById("columns-menu"),
    status: document.getElementById("status"),
  };

  if (refs.status) refs.status.textContent = "Loading data…";
  let model;
  try {
    model = await loadModel();
  } catch (err) {
    console.error(err);
    if (refs.status) refs.status.textContent = "Failed to load data. See console.";
    return;
  }
  if (refs.status) refs.status.textContent = "";

  const allColumns = displayColumns(model.headers);
  // Seed: defaults <- device prefs (columns/ui) <- URL (shareable state).
  const prefs = loadPrefs();
  const initial = { ...makeInitialState(), ...prefs, ...decodeState(location) };
  // First load (no saved columns) defaults both views to the "textual" preset.
  if (!prefs.columns) {
    const def = getPreset(DEFAULT_COLUMN_PRESET, allColumns);
    initial.columns = { merged: def, table: def };
  }
  const store = createStore(initial);
  store.subscribe((state) => savePrefs(state));

  // Column-visibility selector.
  if (refs.columnsMenu) {
    buildColumnsMenu(refs.columnsMenu, allColumns);
    bindColumnsMenu(refs.columnsMenu, store, allColumns);
  }

  // Text View rows are clickable -> details modal. `currentTextRows` mirrors the
  // latest rendered result so a click can resolve its record by index.
  let currentTextRows = [];
  if (refs.tableView) {
    refs.tableView.addEventListener("click", (e) => {
      const tr = e.target.closest && e.target.closest("tr[data-row-idx]");
      if (!tr) return;
      const row = currentTextRows[Number(tr.dataset.rowIdx)];
      if (row) openRowModal(row, allColumns, maps);
    });
  }
  const rowPdfBtn = document.getElementById("download-pdf-btn");
  if (rowPdfBtn) {
    rowPdfBtn.addEventListener("click", () => exportRowDetailsPdf(document.getElementById("rowDetailsModal")));
  }

  // Build the facet sidebar once from the unfiltered option universe.
  const universe = computeCounts(model.manuscripts, makeInitialState(), FACET_DEFS, {
    scope: "manuscript",
    puByKey: model.puByKey,
  });
  buildFacetSidebar(refs.sidebar, universe);
  bindFacetEvents(refs.sidebar, store);
  bindControls(store, refs);

  // Manuscript details modal: load segments lazily, then open on row/shelfmark click.
  const [segments, depositoryMap, maps] = await Promise.all([
    loadSegments(),
    loadDepositoryMap(),
    loadExpansionMaps(),
  ]);

  // Row-level search index (built after maps so expansions are searchable too).
  const searchIndex = buildSearchIndex(model.rows, maps);
  if (refs.mergedView) {
    refs.mergedView.addEventListener("click", (e) => {
      const link = e.target.closest && e.target.closest("a.ms-open-details");
      if (link) e.preventDefault();
      const el = e.target.closest && e.target.closest("[data-ms-key]");
      if (!el) return;
      const msKey = el.getAttribute("data-ms-key");
      const sourceId = el.getAttribute("data-source-id");
      if (!msKey || msKey === "||" || !sourceId) return;
      openManuscriptModal(
        { sourceId, msKey },
        { indexBySource: segments.indexBySource, depositoryMap, rawByKey: model.rawByKey, maps }
      );
    });
  }

  const pdfBtn = document.getElementById("download-ms-pdf-btn");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", () => exportManuscriptPdf(document.getElementById("msDetailsModal")));
  }

  function renderAll(state) {
    const q = makeIndexQuery(searchIndex, state.query);
    const result = selectResults(model, state, { matchesQuery: q && q.matches, scoreOf: q && q.score });

    syncFacetSidebar(refs.sidebar, state, result.counts);
    if (refs.columnsMenu) syncColumnsMenu(refs.columnsMenu, allColumns, state);

    const cols = visibleColumns(allColumns, state);
    const isTable = state.view === "table";
    if (refs.tableView) refs.tableView.style.display = isTable ? "" : "none";
    if (refs.mergedView) refs.mergedView.style.display = isTable ? "none" : "";

    let pageInfo = null;
    if (isTable) {
      currentTextRows = result.rows;
      pageInfo = renderTextTable(refs.tableView, result.rows, state, cols, maps);
    } else if (refs.mergedView) {
      pageInfo = renderManuscriptView(refs.mergedView, result.manuscripts, state, {
        columns: cols,
        columnsFull: allColumns,
        rawByKey: model.rawByKey,
        mergesBySource: model.mergesBySource,
        maps,
      });
    }

    renderControls(refs, state, result, pageInfo);
  }

  store.subscribe((state) => renderAll(state));
  startHistorySync(store);
  renderAll(store.get());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
