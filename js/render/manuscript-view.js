// Manuscript View: regroups rows by manuscript and redraws Excel rowspan/colspan
// merges, with frozen Depository+Shelf mark columns, production-unit striping, and
// manuscript pagination. Ported faithfully from the legacy renderMergedView.
//
// Main/Minor text are expanded via model/expand.js; links via render/links.js.

import { escapeHtml, normalizeForCompare } from "../util/text.js";
import { normalizeLeavesPages } from "../model/fields.js";
import { aggregateFieldValues, allFieldValuesEmpty, getConstantFields, getEffectiveValue, productionUnitRuns } from "../model/manuscript.js";
import { expandMainText, expandMinorText, mainCandidatesFrom } from "../model/expand.js";
import { buildLocalMergeLookup } from "./merge-geometry.js";
import { freezeColumns } from "./frozen-columns.js";
import { renderLinksHtml } from "./links.js";
import { columnTitle as colTitle } from "../config.js";

/** Cell HTML for the grouped views (Manuscript + Production Unit). */
export function renderCell(field, value, ctx) {
  const v = normalizeForCompare(value);
  if (!v) return "&nbsp;";
  if (field === "Shelf mark") {
    const label = escapeHtml(String(value));
    if (ctx.msKey && ctx.sourceId) {
      return `<a href="#" class="ms-open-details" data-ms-key="${escapeHtml(ctx.msKey)}" data-source-id="${escapeHtml(ctx.sourceId)}">${label}</a>`;
    }
    return label;
  }
  if (field === "Links to Database") return renderLinksHtml(v) || "&nbsp;";
  if (field === "Leaves/Pages") return escapeHtml(normalizeLeavesPages(v));
  if (field === "Main text" && ctx.maps) return escapeHtml(expandMainText(v, ctx.maps));
  if (field === "Minor text" && ctx.maps) {
    const mainCtx = getEffectiveValue(ctx.msRows, ctx.rowIndex, "Main text");
    return escapeHtml(expandMinorText(v, mainCandidatesFrom(mainCtx), ctx.maps));
  }
  return escapeHtml(v);
}

/** The current page of `items` per state.page/pageSize, with the clamped page number. */
export function paginate(items, state) {
  const total = items.length;
  const pageSize = state.pageSize === "all" ? Infinity : state.pageSize;
  const totalPages = Number.isFinite(pageSize) ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const page = Math.min(Math.max(1, state.page || 1), totalPages);
  const start = Number.isFinite(pageSize) ? (page - 1) * pageSize : 0;
  const pageItems = Number.isFinite(pageSize) ? items.slice(start, start + pageSize) : items;
  return { total, totalPages, page, pageItems };
}

/**
 * Render the paginated Manuscript View into `host`.
 * @returns {{page:number, totalPages:number, total:number, shown:number}}
 */
export function renderManuscriptView(host, manuscripts, state, opts) {
  const { columns, columnsFull, rawByKey, mergesBySource, maps = null } = opts;
  const { total, totalPages, page, pageItems } = paginate(manuscripts, state);

  if (total === 0) {
    host.innerHTML = `<div class="text-secondary p-3">No matching manuscripts.</div>`;
    return { page: 1, totalPages: 1, total: 0, shown: 0 };
  }

  let html = '<table class="table table-bordered merged-table"><thead><tr>';
  for (const col of columns) html += `<th data-field="${escapeHtml(col)}">${escapeHtml(colTitle(col))}</th>`;
  html += "</tr></thead><tbody>";

  pageItems.forEach((ms, msIndex) => {
    const msClass = msIndex % 2 === 0 ? "ms-a" : "ms-b";
    const rawBlock = rawByKey.get(ms.key);
    const msRows = rawBlock && rawBlock.rows && rawBlock.rows.length > 0 ? rawBlock.rows : ms.rows;
    const msRowCount = msRows.length;
    const sourceId = rawBlock && rawBlock.sourceId ? rawBlock.sourceId : ms.sourceId || null;
    const cellCtx = { msKey: ms.key, sourceId, maps, msRows, rowIndex: 0 };

    const mergedLinks = aggregateFieldValues(msRows, "Links to Database", "; ");
    const literatureEmpty = allFieldValuesEmpty(msRows, "Literature");

    const mergesJson = sourceId ? mergesBySource.get(sourceId) : null;
    const mergeLookup = mergesJson ? buildLocalMergeLookup(msRows, mergesJson, columnsFull, columns) : null;
    const msConst = mergeLookup ? null : getConstantFields(msRows, columns, ["Production Unit"]);

    // Contiguous Production Unit runs (for striping + rowspan).
    const runs = productionUnitRuns(msRows);
    const rowToRun = new Array(msRowCount);
    runs.forEach((r, i) => rowToRun.fill(i, r.start, r.end + 1));

    const runConstByStart = new Map();
    if (!mergeLookup) {
      for (const r of runs) runConstByStart.set(r.start, getConstantFields(msRows.slice(r.start, r.end + 1), columns, []));
    }

    for (let rIndex = 0; rIndex < msRowCount; rIndex++) {
      const row = msRows[rIndex];
      cellCtx.rowIndex = rIndex;
      const isFirst = rIndex === 0;
      html += `<tr class="${msClass}${isFirst ? " ms-sep" : ""}" data-ms-key="${escapeHtml(ms.key)}" data-source-id="${escapeHtml(sourceId || "")}">`;

      const puClass = (rowToRun[rIndex] || 0) % 2 === 0 ? "pu-a" : "pu-b";
      let runStartIdx = rIndex;
      let runEndIdx = rIndex;
      for (const rr of runs) {
        if (rr.start <= rIndex && rIndex <= rr.end) {
          runStartIdx = rr.start;
          runEndIdx = rr.end;
          break;
        }
      }
      const isRunStart = rIndex === runStartIdx;
      const runRowSpan = runEndIdx - runStartIdx + 1;
      const runConst = !mergeLookup && isRunStart ? runConstByStart.get(runStartIdx) : null;

      for (let c = 0; c < columns.length; c++) {
        const col = columns[c];

        if (col === "Links to Database") {
          if (!isFirst) continue;
          html += `<td class="${msClass}" data-field="${escapeHtml(col)}" rowspan="${msRowCount}">${renderCell(col, mergedLinks, cellCtx)}</td>`;
          continue;
        }
        if (col === "Literature" && literatureEmpty) {
          if (!isFirst) continue;
          html += `<td class="${msClass}" data-field="${escapeHtml(col)}" rowspan="${msRowCount}">&nbsp;</td>`;
          continue;
        }

        if (mergeLookup) {
          if (col === "Language") {
            if (!isFirst) continue;
            html += `<td class="${msClass}" data-field="${escapeHtml(col)}" rowspan="${msRowCount}">${renderCell(col, row[col], cellCtx)}</td>`;
            continue;
          }
          const key = `${rIndex},${c}`;
          if (mergeLookup.covered.has(key)) continue;
          const span = mergeLookup.topLeft.get(key);
          const attrs = span ? ` rowspan="${span.rowSpan}" colspan="${span.colSpan}"` : "";
          const cls = col === "Production Unit" ? puClass : msClass;
          html += `<td class="${cls}" data-field="${escapeHtml(col)}"${attrs}>${renderCell(col, row[col], cellCtx)}</td>`;
          continue;
        }

        if (msConst && msConst.has(col)) {
          if (!isFirst) continue;
          html += `<td class="${msClass}" data-field="${escapeHtml(col)}" rowspan="${msRowCount}">${renderCell(col, row[col], cellCtx)}</td>`;
          continue;
        }
        if (col === "Production Unit") {
          if (!isRunStart) continue;
          html += `<td class="${puClass}" data-field="${escapeHtml(col)}" rowspan="${runRowSpan}">${renderCell(col, row[col], cellCtx)}</td>`;
          continue;
        }
        if (runConst && runConst.has(col)) {
          html += `<td class="${puClass}" data-field="${escapeHtml(col)}" rowspan="${runRowSpan}">${renderCell(col, row[col], cellCtx)}</td>`;
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
