// Results export laid out like the grouped views: one block of raw rows per
// manuscript (Manuscript View) or per Production Unit run (Production Unit
// View), with the source sheet's merged cells as spreadsheet merge ranges.
// Follows the views' rules: Links to Database is aggregated per manuscript and
// Language spans the block; without merge data, values constant over the block
// are merged, and Production Unit (plus values constant over a unit) per unit run.
// DOM-free (tested).

import { columnTitle } from "../config.js";
import { normalizeLeavesPages } from "../model/fields.js";
import { aggregateFieldValues, allFieldValuesEmpty, getConstantFields, productionUnitRuns } from "../model/manuscript.js";
import { buildLocalMergeLookup, clipMergeLookup } from "../render/merge-geometry.js";
import { cleanCell } from "./table.js";

const cellText = (col, value) => {
  const v = cleanCell(value);
  return col === "Leaves/Pages" && v ? normalizeLeavesPages(v) : v;
};

/**
 * @param {object[]} items manuscripts (view "merged") or units {ms, run} (view "units"), in order
 * @param {string} view "merged" | "units"
 * @param {{columns:string[], columnsFull:string[], rawByKey:Map, mergesBySource:Map}} opts
 * @returns {{matrix:string[][], merges:{r0:number,c0:number,r1:number,c1:number}[]}}
 *   matrix row 0 is the header; merge coordinates are 0-based matrix indices.
 */
export function groupedSheet(items, view, { columns, columnsFull, rawByKey, mergesBySource }) {
  const matrix = [columns.map(columnTitle)];
  const merges = [];
  const msCache = new Map();

  const infoFor = (ms) => {
    if (msCache.has(ms.key)) return msCache.get(ms.key);
    const rawBlock = rawByKey.get(ms.key);
    const msRows = rawBlock && rawBlock.rows && rawBlock.rows.length ? rawBlock.rows : ms.rows;
    const sourceId = (rawBlock && rawBlock.sourceId) || ms.sourceId || null;
    const mergesJson = sourceId ? mergesBySource.get(sourceId) : null;
    const info = {
      msRows,
      links: aggregateFieldValues(msRows, "Links to Database", "; "),
      literatureEmpty: allFieldValuesEmpty(msRows, "Literature"),
      lookup: mergesJson ? buildLocalMergeLookup(msRows, mergesJson, columnsFull, columns) : null,
    };
    msCache.set(ms.key, info);
    return info;
  };

  for (const item of items) {
    const ms = view === "units" ? item.ms : item;
    const { msRows, links, literatureEmpty, lookup } = infoFor(ms);
    const start = view === "units" ? item.run.start : 0;
    const end = view === "units" ? item.run.end : msRows.length - 1;
    const rows = msRows.slice(start, end + 1);
    if (!rows.length) continue;

    // The block's cells: raw values first, then merges laid over them.
    const grid = rows.map((row) =>
      columns.map((col) => (col === "Literature" && literatureEmpty ? "" : cellText(col, row[col])))
    );
    const taken = rows.map(() => new Array(columns.length).fill(false));
    const blockMerges = [];
    // Accept a merge unless it overlaps one already placed (Excel rejects overlaps);
    // the top-left cell gets `value`, the rest are blanked.
    const place = (r0, c0, r1, c1, value) => {
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (taken[r][c]) return;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        taken[r][c] = true;
        grid[r][c] = "";
      }
      grid[r0][c0] = value;
      if (r1 > r0 || c1 > c0) blockMerges.push({ r0, c0, r1, c1 });
    };
    const last = rows.length - 1;
    const colIdx = (name) => columns.indexOf(name);

    const linksCol = colIdx("Links to Database");
    if (linksCol !== -1) place(0, linksCol, last, linksCol, cleanCell(links));
    const langCol = colIdx("Language");
    if (langCol !== -1) place(0, langCol, last, langCol, cleanCell(rows[0].Language));

    if (lookup) {
      const clipped = clipMergeLookup(lookup, start, end);
      for (const [key, span] of clipped.topLeft) {
        const [r, c] = key.split(",").map(Number);
        // A clipped merge's value lives on its original top row, possibly above the
        // block; a piece cut down to one cell still takes it (place adds no merge).
        place(r, c, r + span.rowSpan - 1, c + span.colSpan - 1, cellText(columns[c], msRows[span.row][columns[c]]));
      }
    } else {
      for (const col of getConstantFields(rows, columns, ["Production Unit"])) {
        const c = colIdx(col);
        place(0, c, last, c, grid[0][c]);
      }
      const puCol = colIdx("Production Unit");
      for (const run of productionUnitRuns(rows)) {
        const runConst = getConstantFields(rows.slice(run.start, run.end + 1), columns, []);
        if (puCol !== -1) runConst.add("Production Unit");
        for (const col of runConst) {
          const c = colIdx(col);
          place(run.start, c, run.end, c, grid[run.start][c]);
        }
      }
    }

    const offset = matrix.length;
    for (const m of blockMerges) merges.push({ ...m, r0: m.r0 + offset, r1: m.r1 + offset });
    matrix.push(...grid);
  }
  return { matrix, merges };
}
