// Pure merge-geometry helpers for Manuscript View. No DOM.
//
// The raw per-language TSVs preserve Excel's blank cells; a sibling *_merges.json
// records each merged region as row/column index ranges. These functions turn
// that into (a) filled-down values and (b) a per-manuscript rowspan/colspan
// lookup mapped onto the currently visible columns.

import { normalizeForCompare } from "../util/text.js";

/**
 * Fill merged cells downward in place: for each merge region, copy the top-left
 * value into the blank cells it covers. Rows are matched by __sourceRowIndex.
 *
 * @param {object[]} rows  raw rows carrying __sourceRowIndex.
 * @param {object} mergesJson  {columns?: string[], merges: [{minRow,maxRow,minColIndex,maxColIndex,minCol}]}
 */
export function applyMergeAwareFillDown(rows, mergesJson) {
  if (!mergesJson || !Array.isArray(mergesJson.merges) || mergesJson.merges.length === 0) return;
  const mergeColumns = Array.isArray(mergesJson.columns) ? mergesJson.columns : null;

  const byIndex = new Map();
  for (const r of rows) {
    if (r && typeof r.__sourceRowIndex === "number") byIndex.set(r.__sourceRowIndex, r);
  }

  for (const m of mergesJson.merges) {
    if (!m) continue;
    if (typeof m.minRow !== "number" || typeof m.maxRow !== "number") continue;

    let colNames = [];
    if (mergeColumns && typeof m.minColIndex === "number" && typeof m.maxColIndex === "number") {
      colNames = mergeColumns.slice(m.minColIndex, m.maxColIndex + 1).map(String);
    } else if (m.minCol) {
      colNames = [String(m.minCol)];
    }

    for (const col of colNames) {
      if (!col) continue;
      const topRow = byIndex.get(m.minRow);
      if (!topRow) continue;
      const topVal = topRow[col];
      if (!normalizeForCompare(topVal)) continue;
      for (let i = m.minRow; i <= m.maxRow; i++) {
        const row = byIndex.get(i);
        if (!row) continue;
        if (!normalizeForCompare(row[col])) row[col] = topVal;
      }
    }
  }
}

/**
 * Build a rowspan/colspan lookup for one manuscript's rows, mapped onto the
 * visible-column grid. Only merges fully contained within these rows are kept.
 *
 * @returns {{topLeft: Map<string,{rowSpan,colSpan}>, covered: Set<string>, columns: string[]}|null}
 *   Keyed by "localRow,visibleCol". `topLeft` marks the cell to render with a
 *   span; `covered` marks cells to skip. null when there is no merge data.
 */
export function buildLocalMergeLookup(rawRows, mergesJson, columnsFull, columnsVisible) {
  if (!mergesJson || !Array.isArray(mergesJson.merges)) return null;

  const rowIndexToLocal = new Map();
  for (let i = 0; i < rawRows.length; i++) {
    rowIndexToLocal.set(rawRows[i].__sourceRowIndex, i);
  }

  const full = Array.isArray(columnsFull) && columnsFull.length > 0 ? columnsFull : columnsVisible;
  const visible = Array.isArray(columnsVisible) && columnsVisible.length > 0 ? columnsVisible : full;
  const fullIndex = new Map(full.map((c, idx) => [c, idx]));
  const visibleIndex = new Map(visible.map((c, idx) => [c, idx]));

  const topLeft = new Map();
  const covered = new Set();

  for (const m of mergesJson.merges) {
    const minSrcRow = m.minRow;
    const maxSrcRow = m.maxRow;
    if (!rowIndexToLocal.has(minSrcRow) || !rowIndexToLocal.has(maxSrcRow)) continue;

    let fullyContained = true;
    for (let r = minSrcRow; r <= maxSrcRow; r++) {
      if (!rowIndexToLocal.has(r)) {
        fullyContained = false;
        break;
      }
    }
    if (!fullyContained) continue;

    if (!fullIndex.has(m.minCol) || !fullIndex.has(m.maxCol)) continue;
    const a = Math.min(fullIndex.get(m.minCol), fullIndex.get(m.maxCol));
    const b = Math.max(fullIndex.get(m.minCol), fullIndex.get(m.maxCol));

    const visibleColsInRange = [];
    for (let i = a; i <= b; i++) {
      const colName = full[i];
      if (visibleIndex.has(colName)) visibleColsInRange.push(visibleIndex.get(colName));
    }
    if (visibleColsInRange.length === 0) continue;
    const minCol = Math.min(...visibleColsInRange);
    const maxCol = Math.max(...visibleColsInRange);

    const minRow = rowIndexToLocal.get(minSrcRow);
    const maxRow = rowIndexToLocal.get(maxSrcRow);
    const rowSpan = maxRow - minRow + 1;
    const colSpan = maxCol - minCol + 1;
    if (rowSpan <= 1 && colSpan <= 1) continue;

    const tlKey = `${minRow},${minCol}`;
    topLeft.set(tlKey, { rowSpan, colSpan });
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const k = `${r},${c}`;
        if (k !== tlKey) covered.add(k);
      }
    }
  }

  return { topLeft, covered, columns: visible };
}
