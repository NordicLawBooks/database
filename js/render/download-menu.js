// Toolbar "Download" menu: the current results (every page, in the current
// sort) as TSV or .xlsx, with the visible columns or all of them. In the
// grouped views the .xlsx can instead be laid out like the view, with merged
// cells (js/export/grouped.js).

import { exportMatrix, toTsv, exportFilename } from "../export/table.js";
import { groupedSheet } from "../export/grouped.js";
import { buildXlsx } from "../export/xlsx.js";
import { saveBlob } from "../util/download.js";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const VIEW_NAMES = { merged: "Manuscript View", units: "Production Unit View" };

/**
 * @param {HTMLElement} host the dropdown menu (#download-menu)
 * @param {() => {rows:object[], items:object[], visibleColumns:string[], allColumns:string[], view:string, model:object}} getExport
 *   the latest rendered result, read at click time.
 */
export function bindDownloadMenu(host, getExport) {
  if (!host) return;
  const summary = host.querySelector("[data-download-summary]");
  const mergeBox = host.querySelector("#download-merge");
  const tsvButton = host.querySelector('button[data-download="tsv"]');

  /** What a download would contain right now. */
  const plan = () => {
    const ex = getExport();
    const all = host.querySelector('input[name="download-cols"]:checked')?.value === "all";
    const columns = all ? ex.allColumns : ex.visibleColumns;
    const grouped = ex.view !== "table" && !!mergeBox?.checked;
    return { ex, columns, grouped };
  };

  const sheetFor = ({ ex, columns, grouped }) =>
    grouped
      ? groupedSheet(ex.items, ex.view, {
          columns,
          columnsFull: ex.allColumns,
          rawByKey: ex.model.rawByKey,
          mergesBySource: ex.model.mergesBySource,
        })
      : { matrix: exportMatrix(ex.rows, columns), merges: [] };

  const refresh = () => {
    const p = plan();
    const isTable = p.ex.view === "table";
    if (mergeBox) {
      mergeBox.disabled = isTable;
      mergeBox.closest(".form-check")?.classList.toggle("opacity-50", isTable);
    }
    if (tsvButton) {
      tsvButton.disabled = p.grouped;
      tsvButton.title = p.grouped ? "TSV can't hold merged cells; untick “Merge cells” to download TSV." : "";
    }
    if (!summary) return;
    const n = p.ex.rows.length;
    if (!n) {
      summary.textContent = "No results to download.";
    } else if (p.grouped) {
      const rows = sheetFor(p).matrix.length - 1;
      summary.textContent = `${rows.toLocaleString("en")} rows laid out as in ${VIEW_NAMES[p.ex.view]} (sheet rows, merged cells kept), all pages.`;
    } else {
      summary.textContent = `${n.toLocaleString("en")} ${n === 1 ? "text" : "texts"} (one row per text) in the current results, all pages.`;
    }
  };

  host.parentElement?.addEventListener("show.bs.dropdown", refresh);
  host.addEventListener("change", refresh);

  host.addEventListener("click", async (e) => {
    const btn = e.target.closest && e.target.closest("button[data-download]");
    if (!btn) return;
    const p = plan();
    if (!p.ex.rows.length) return;
    const format = btn.dataset.download;
    if (format === "tsv" && !p.grouped) {
      // The BOM lets Excel detect UTF-8 when the TSV is opened directly.
      const tsv = toTsv(exportMatrix(p.ex.rows, p.columns));
      saveBlob(new Blob(["﻿", tsv], { type: "text/tab-separated-values;charset=utf-8" }), exportFilename(p.ex.view, "tsv"));
      return;
    }
    if (format === "xlsx") {
      btn.disabled = true;
      try {
        const { matrix, merges } = sheetFor(p);
        const bytes = await buildXlsx(matrix, { sheetName: "NordicLaw", merges });
        saveBlob(new Blob([bytes], { type: XLSX_TYPE }), exportFilename(p.ex.view, "xlsx"));
      } catch (err) {
        console.error("XLSX export failed:", err);
      } finally {
        btn.disabled = false;
      }
    }
  });
}
