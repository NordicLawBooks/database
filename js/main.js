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
import { computeCounts, rangeExtent } from "./facets/engine.js";
import { selectResults } from "./filter/pipeline.js";
import { buildFacetSidebar, syncFacetSidebar, bindFacetEvents } from "./facets/render.js";
import { renderTextTable, displayColumns } from "./render/text-table.js";
import { renderManuscriptView } from "./render/manuscript-view.js";
import { refreezeOnResize } from "./render/frozen-columns.js";
import { bindSidebar, syncSidebar } from "./render/sidebar.js";
import { buildColumnsMenu, syncColumnsMenu, bindColumnsMenu, visibleColumns } from "./render/columns.js";
import { bindControls, renderControls } from "./render/controls.js";
import { buildSearchIndex, makeIndexQuery } from "./search/index.js";
import { loadPrefs, savePrefs, withRememberedViewSort } from "./prefs.js";

async function main() {
  const refs = {
    search: document.getElementById("search"),
    searchButton: document.getElementById("search-btn"),
    viewSelect: document.getElementById("view-select"),
    sortSelect: document.getElementById("sort-select"),
    pageSizeSelect: document.getElementById("page-size-select"),
    clearButton: document.getElementById("clear-filters"),
    meta: document.getElementById("result-meta"),
    pager: document.getElementById("pager"),
    sidebar: document.getElementById("facet-sidebar"),
    facets: document.getElementById("facet-accordion"),
    sidebarToggle: document.getElementById("toggle-facets"),
    sidebarResizer: document.getElementById("facet-resizer"),
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
  // Seed: defaults <- device prefs (columns, ui, last view/sort) <- URL (shareable
  // state; a view/sort named in the URL beats the remembered one).
  const prefs = loadPrefs();
  const base = makeInitialState();
  const initial = {
    ...base,
    ...withRememberedViewSort(decodeState(location), location.search, prefs),
    ui: { ...base.ui, ...prefs.ui },
  };
  // A view with no saved column choice defaults to the "textual" preset (null = all).
  const def = getPreset(DEFAULT_COLUMN_PRESET, allColumns);
  const saved = prefs.columns || {};
  initial.columns = {
    merged: saved.merged === undefined ? def : saved.merged,
    table: saved.table === undefined ? def : saved.table,
  };
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

  bindControls(store, refs);
  const sidebarRefs = { toggle: refs.sidebarToggle, sidebar: refs.sidebar, resizer: refs.sidebarResizer };
  bindSidebar(store, sidebarRefs);
  syncSidebar(sidebarRefs, store.get().ui);

  // Manuscript details modal: load segments lazily, then open on row/shelfmark click.
  const [segments, depositoryMap, maps] = await Promise.all([
    loadSegments(),
    loadDepositoryMap(),
    loadExpansionMaps(),
  ]);

  // Row-level search index (built after maps so expansions are searchable too).
  const searchIndex = buildSearchIndex(model.rows, maps);

  // Build the facet sidebar once from the unfiltered option universe (after the
  // expansion maps load, so Main text group labels can be spelled out).
  const universe = computeCounts(model.manuscripts, makeInitialState(), FACET_DEFS, {
    scope: "manuscript",
    puByKey: model.puByKey,
  });
  const extents = {};
  for (const def of FACET_DEFS) {
    if (def.type === "range" || def.type === "range+terms") extents[def.field] = rangeExtent(model.rows, def);
  }
  buildFacetSidebar(refs.facets, universe, { maps, extents });
  bindFacetEvents(refs.facets, store);
  refreezeOnResize(document);
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
    syncSidebar(sidebarRefs, state.ui);
    const q = makeIndexQuery(searchIndex, state.query);
    const result = selectResults(model, state, { matchesQuery: q && q.matches, scoreOf: q && q.score });

    syncFacetSidebar(refs.facets, state, result.counts);
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
