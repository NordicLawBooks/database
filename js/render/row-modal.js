// Text View row-details modal: one record's fields as a two-column label/value
// list. The markup mirrors what the row PDF exporter scrapes
// (.col-md-6 > .mb-2.border-bottom.pb-1 with .fw-bold + .text-break).

import { escapeHtml } from "../util/text.js";
import { renderLinksHtml } from "./links.js";
import { expandMainText, expandMinorText, mainCandidatesFrom } from "../model/expand.js";
import { HIDDEN_FIELDS } from "../config.js";
import { columnTitle as colTitle } from "../config.js";

const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();

/** Build the two-column details HTML for a single row. */
export function buildRowDetailsHtml(row, columns, maps = null) {
  const entries = [];
  for (const key of columns) {
    if (HIDDEN_FIELDS.has(key)) continue;
    const raw = row[key] != null ? row[key] : "";
    let value;
    if (key === "Links to Database") value = renderLinksHtml(raw);
    else if (key === "Main text" && maps) value = escapeHtml(expandMainText(raw, maps));
    else if (key === "Minor text" && maps) value = escapeHtml(expandMinorText(raw, mainCandidatesFrom(row["Main text"]), maps));
    else value = escapeHtml(String(raw));
    entries.push({ key, value });
  }
  const half = Math.ceil(entries.length / 2);
  const col = (items) =>
    items
      .map(
        (e) =>
          `<div class="mb-2 border-bottom pb-1"><div class="fw-bold small">${escapeHtml(colTitle(e.key))}</div><div class="text-break">${e.value || "&nbsp;"}</div></div>`
      )
      .join("");
  return `<div class="row"><div class="col-md-6">${col(entries.slice(0, half))}</div><div class="col-md-6">${col(entries.slice(half))}</div></div>`;
}

/** Populate and show the Text View details modal for `row`. */
export function openRowModal(row, columns, maps = null) {
  const modalEl = document.getElementById("rowDetailsModal");
  const contentDiv = document.getElementById("row-details-content");
  if (!modalEl || !contentDiv) return;

  contentDiv.innerHTML = buildRowDetailsHtml(row, columns, maps);

  const dep = row["Depository_abbr"] || row["Depository"] || "";
  const shelf = row["Shelf mark"] || "";
  const filename = `${safe(dep)}_${safe(shelf)}.pdf`;
  modalEl.dataset.filename = filename;
  const pdfBtn = document.getElementById("download-pdf-btn");
  if (pdfBtn) pdfBtn.dataset.filename = filename;

  const bs = typeof window !== "undefined" ? window.bootstrap : null;
  if (bs && bs.Modal) bs.Modal.getOrCreateInstance(modalEl).show();
}
