// Text View: a flat, paginated table of rows. (Manuscript View, with merged
// cells, is a separate renderer added in a later step.)

import { escapeHtml } from "../util/text.js";
import { expandMainText, expandMinorText, mainCandidatesFrom } from "../model/expand.js";
import { renderLinksHtml } from "./links.js";
import { COLUMN_ORDER, HIDDEN_FIELDS } from "../config.js";

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

  const head = columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join("");
  const cellHtml = (row, c) => {
    if (maps && c === "Main text") return escapeHtml(expandMainText(row[c], maps));
    if (maps && c === "Minor text") return escapeHtml(expandMinorText(row[c], mainCandidatesFrom(row["Main text"]), maps));
    if (c === "Links to Database") return renderLinksHtml(row[c]) || "";
    return escapeHtml(row[c] == null ? "" : row[c]);
  };
  const body = slice
    .map((row, i) => {
      const tds = columns.map((c) => `<td>${cellHtml(row, c)}</td>`).join("");
      return `<tr role="button" data-row-idx="${start + i}">${tds}</tr>`;
    })
    .join("");

  host.innerHTML =
    `<div class="table-responsive">` +
    `<table class="table table-sm table-striped table-hover align-top">` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;

  return { page, totalPages, total, shown: slice.length };
}
