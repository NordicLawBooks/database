// Results export: the current result rows as a header + body matrix, and TSV.
// DOM-free (tested); js/render/download-menu.js turns these into files.

import { columnTitle } from "../config.js";

/** One cell's export text: tabs and line breaks become spaces, ends trimmed. */
export function cleanCell(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

/**
 * The rows as a matrix: a header row of column titles, then one row per record
 * with that record's value for each column (raw data values, filled down per
 * manuscript as in the model; abbreviations are not expanded).
 * @param {object[]} rows
 * @param {string[]} columns field names, in export order
 * @returns {string[][]}
 */
export function exportMatrix(rows, columns) {
  return [columns.map(columnTitle), ...rows.map((row) => columns.map((c) => cleanCell(row[c])))];
}

/** Matrix -> TSV text (LF line ends, trailing newline). */
export function toTsv(matrix) {
  return matrix.map((r) => r.map(cleanCell).join("\t")).join("\n") + "\n";
}

const VIEW_LABELS = { table: "texts", units: "production-units", merged: "manuscripts" };

/** Download name, e.g. "nordiclaw-manuscripts-2026-11-11.xlsx". */
export function exportFilename(view, ext, date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  return `nordiclaw-${VIEW_LABELS[view] || "results"}-${day}.${ext}`;
}
