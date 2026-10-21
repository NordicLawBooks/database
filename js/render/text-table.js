// Text View: a flat, paginated table of rows, sharing Manuscript View's table
// styling (sticky header) and frozen Depository + Shelf mark columns. The Shelf
// mark is a link that opens the row's details modal.

import { escapeHtml } from "../util/text.js";
import { expandMainText, expandMinorText, mainCandidatesFrom } from "../model/expand.js";
import { renderLinksHtml } from "./links.js";
import { COLUMN_ORDER, HIDDEN_FIELDS, columnTitle } from "../config.js";
import { freezeColumns } from "./frozen-columns.js";

/** Visible columns in canonical order, hiding internal/derived fields. */
export function displayColumns(headers) {
  const present = (headers || []).filter((h) => h && !HIDDEN_FIELDS.has(h));
  const inOrder = COLUMN_ORDER.filter((c) => present.includes(c));
  const extras = present.filter((c) => !COLUMN_ORDER.includes(c));
  return [...inOrder, ...extras];
}

/**
 * Render the paginated table into `host`.
 * @returns {{page:number, totalPages:number, total:number, shown:number}}
 */
export function renderTextTable(host, rows, state, columns, maps = null) {
  const total = rows.length;
  const pageSize = state.pageSize === "all" ? Infinity : state.pageSize;
  const totalPages = Number.isFinite(pageSize) ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const page = Math.min(Math.max(1, state.page || 1), totalPages);
  const start = Number.isFinite(pageSize) ? (page - 1) * pageSize : 0;
  const slice = Number.isFinite(pageSize) ? rows.slice(start, start + pageSize) : rows;

  if (total === 0) {
    host.innerHTML = `<div class="text-secondary p-3">No matching records.</div>`;
    return { page: 1, totalPages: 1, total: 0, shown: 0 };
  }

  const head = columns.map((c) => `<th scope="col" data-field="${escapeHtml(c)}">${escapeHtml(columnTitle(c))}</th>`).join("");
  const cellHtml = (row, c) => {
    if (maps && c === "Main text") return escapeHtml(expandMainText(row[c], maps));
    if (maps && c === "Minor text") return escapeHtml(expandMinorText(row[c], mainCandidatesFrom(row["Main text"]), maps));
    if (c === "Links to Database") return renderLinksHtml(row[c]) || "";
    if (c === "Shelf mark" && row[c]) return `<a href="#" class="row-open-details">${escapeHtml(row[c])}</a>`;
    return escapeHtml(row[c] == null ? "" : row[c]);
  };
  const body = slice
    .map((row, i) => {
      const tds = columns.map((c) => `<td data-field="${escapeHtml(c)}">${cellHtml(row, c)}</td>`).join("");
      return `<tr data-row-idx="${start + i}">${tds}</tr>`;
    })
    .join("");

  host.innerHTML =
    `<div class="table-responsive">` +
    `<table class="table table-sm table-striped table-hover merged-table text-table">` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;

  freezeColumns(host.querySelector("table"));

  return { page, totalPages, total, shown: slice.length };
}
