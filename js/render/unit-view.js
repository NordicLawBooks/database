// Production Unit View: one block per contiguous Production Unit run, each
// under a header row naming the manuscript and unit. The units themselves are
// the items (listUnits): sorted and paginated individually, so under "dating" a
// manuscript's units may be far apart.
//
// Excel merges are cut at run edges (clipMergeLookup) rather than dropped, so a
// manuscript-wide merge such as Shelf mark still shows its value in every block.

import { escapeHtml } from "../util/text.js";
import { aggregateFieldValues, allFieldValuesEmpty, getConstantFields, productionUnitLabel } from "../model/manuscript.js";
import { buildLocalMergeLookup, clipMergeLookup } from "./merge-geometry.js";
import { freezeColumns } from "./frozen-columns.js";
import { renderCell, paginate } from "./manuscript-view.js";
import { columnTitle as colTitle } from "../config.js";

/** First non-empty value of `field` across rows. */
function firstValue(rows, field) {
  for (const r of rows) if (r && r[field]) return String(r[field]);
  return "";
}

/**
 * Render the paginated Production Unit View into `host`.
 * @param {Array<{ms:object, run:{start,end,raw}}>} units  from listUnits, in display order
 * @returns {{page:number, totalPages:number, total:number, shown:number}}
 */
export function renderUnitView(host, units, state, opts) {
  const { columns, columnsFull, rawByKey, mergesBySource, maps = null } = opts;
  const { total, totalPages, page, pageItems } = paginate(units, state);

  if (total === 0) {
    host.innerHTML = `<div class="text-secondary p-3">No matching manuscripts.</div>`;
    return { page: 1, totalPages: 1, total: 0, shown: 0 };
  }

  let html = '<table class="table table-bordered merged-table unit-table"><thead><tr>';
  for (const col of columns) html += `<th data-field="${escapeHtml(col)}">${escapeHtml(colTitle(col))}</th>`;
  html += "</tr></thead><tbody>";

  // Per-manuscript data, shared by its units on this page.
  const msInfo = new Map();
  const infoFor = (ms) => {
    if (msInfo.has(ms.key)) return msInfo.get(ms.key);
    const rawBlock = rawByKey.get(ms.key);
    const msRows = rawBlock && rawBlock.rows && rawBlock.rows.length > 0 ? rawBlock.rows : ms.rows;
    const sourceId = rawBlock && rawBlock.sourceId ? rawBlock.sourceId : ms.sourceId || null;
    const cellCtx = { msKey: ms.key, sourceId, maps, msRows, rowIndex: 0 };
    const mergesJson = sourceId ? mergesBySource.get(sourceId) : null;
    const depository = escapeHtml(firstValue(msRows, "Depository"));
    const shelfmark = firstValue(msRows, "Shelf mark");
    const shelfHtml = shelfmark ? renderCell("Shelf mark", shelfmark, cellCtx) : "";
    const info = {
      msRows,
      cellCtx,
      trAttrs: `data-ms-key="${escapeHtml(ms.key)}" data-source-id="${escapeHtml(sourceId || "")}"`,
      mergedLinks: aggregateFieldValues(msRows, "Links to Database", "; "),
      literatureEmpty: allFieldValuesEmpty(msRows, "Literature"),
      msLookup: mergesJson ? buildLocalMergeLookup(msRows, mergesJson, columnsFull, columns) : null,
      title: `${depository}${depository && shelfHtml ? " — " : ""}${shelfHtml}`,
    };
    msInfo.set(ms.key, info);
    return info;
  };

  // Stripe and separate by manuscript: consecutive units of one manuscript form a group.
  let msIndex = -1;
  let prevKey = null;
  pageItems.forEach(({ ms, run }, unitIndex) => {
    const { msRows, cellCtx, trAttrs, mergedLinks, literatureEmpty, msLookup, title } = infoFor(ms);
    const newMs = ms.key !== prevKey;
    if (newMs) msIndex += 1;
    prevKey = ms.key;
    const msClass = msIndex % 2 === 0 ? "ms-a" : "ms-b";
    const runRows = msRows.slice(run.start, run.end + 1);
    const runRowCount = runRows.length;
    const puClass = unitIndex % 2 === 0 ? "pu-a" : "pu-b";
    const mergeLookup = msLookup ? clipMergeLookup(msLookup, run.start, run.end) : null;
    const runConst = mergeLookup ? null : getConstantFields(runRows, columns, ["Production Unit"]);

    html += `<tr class="${msClass} unit-head${newMs ? " ms-sep" : ""}" ${trAttrs}>`;
    html += `<td colspan="${columns.length}"><div class="unit-head-label">`;
    html += `<span class="fw-semibold">${title}</span> <span class="text-secondary">•</span> `;
    html += `<span class="fw-semibold">Production unit:</span> ${escapeHtml(productionUnitLabel(run.raw))} `;
    html += `<span class="text-secondary">(${runRowCount} row${runRowCount === 1 ? "" : "s"})</span>`;
    html += "</div></td></tr>";

    for (let local = 0; local < runRowCount; local++) {
      const rIndex = run.start + local;
      const row = msRows[rIndex];
      cellCtx.rowIndex = rIndex;
      const isFirst = local === 0;
      // A cell spanning the whole run: rendered on its first row, skipped after.
      const runCell = (cls, col, value) =>
        isFirst ? `<td class="${cls}" data-field="${escapeHtml(col)}" rowspan="${runRowCount}">${renderCell(col, value, cellCtx)}</td>` : "";

      html += `<tr class="${msClass}" ${trAttrs}>`;
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c];

        if (col === "Links to Database") {
          html += runCell(msClass, col, mergedLinks);
          continue;
        }
        if (col === "Literature" && literatureEmpty) {
          html += runCell(msClass, col, "");
          continue;
        }

        if (mergeLookup) {
          if (col === "Language") {
            html += runCell(msClass, col, row[col]);
            continue;
          }
          const key = `${local},${c}`;
          if (mergeLookup.covered.has(key)) continue;
          const span = mergeLookup.topLeft.get(key);
          const attrs = span && (span.rowSpan > 1 || span.colSpan > 1) ? ` rowspan="${span.rowSpan}" colspan="${span.colSpan}"` : "";
          // A clipped merge's value lives on its original top row, possibly in an earlier run.
          const value = span ? msRows[span.row][col] : row[col];
          const cls = col === "Production Unit" ? puClass : msClass;
          html += `<td class="${cls}" data-field="${escapeHtml(col)}"${attrs}>${renderCell(col, value, cellCtx)}</td>`;
          continue;
        }

        if (col === "Production Unit" || (runConst && runConst.has(col))) {
          html += runCell(puClass, col, row[col]);
          continue;
        }
        html += `<td data-field="${escapeHtml(col)}">${renderCell(col, row[col], cellCtx)}</td>`;
      }
      html += "</tr>";
    }
  });

  html += "</tbody></table>";
  host.innerHTML = `<div class="table-responsive">${html}</div>`;

  const tableEl = host.querySelector("table.merged-table");
  if (tableEl) freezeColumns(tableEl);

  return { page, totalPages, total, shown: pageItems.length };
}
