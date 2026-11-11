// Collation diagram modal (#collationModal), opened from the "Collation
// diagram" button in the manuscript details modal and stacked on top of it.

import { escapeHtml } from "../util/text.js";
import { quireSvg } from "./collation-svg.js";
import { downloadCollationPdf, downloadCollationPng, downloadCollationSvg } from "./collation-export.js";

// The diagram currently shown, for the download buttons.
let current = null;
let downloadsBound = false;

function bindDownloads() {
  if (downloadsBound) return;
  downloadsBound = true;
  const svgBtn = document.getElementById("download-collation-svg-btn");
  const pngBtn = document.getElementById("download-collation-png-btn");
  if (svgBtn) svgBtn.addEventListener("click", () => current && downloadCollationSvg(current.collation, current.title));
  const pdfBtn = document.getElementById("download-collation-pdf-btn");
  if (pngBtn) pngBtn.addEventListener("click", () => current && downloadCollationPng(current.collation, current.title));
  if (pdfBtn) pdfBtn.addEventListener("click", () => current && downloadCollationPdf(current.collation, current.title));
}

const LEGEND =
  `<svg class="cd-legend" xmlns="http://www.w3.org/2000/svg" width="40" height="18" viewBox="0 0 40 18" aria-hidden="true">` +
  `<path class="cd-leaf" d="M38 3H10A6 6 0 0 0 10 15H38"/></svg> bifolium` +
  `<svg class="cd-legend ms-3" xmlns="http://www.w3.org/2000/svg" width="40" height="18" viewBox="0 0 40 18" aria-hidden="true">` +
  `<path class="cd-single" d="M38 7H8q-4 0 -4 4"/></svg> single leaf`;

/** Modal body HTML for a parsed collation (model/collation.js). */
export function buildCollationHtml(collation) {
  const quires = collation.quires
    .map((q) => {
      const caption = q.note ? `<figcaption>${escapeHtml(q.note)}</figcaption>` : "";
      return `<figure class="cd-fig">${quireSvg(q)}${caption}</figure>`;
    })
    .join("");
  const notes = collation.notes.length
    ? `<ul class="small mb-3">${collation.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
    : "";
  const leaves = collation.quires.reduce((sum, q) => sum + q.count, 0);
  const warnings = collation.warnings.length
    ? `<details class="small mt-2"><summary>Parser notes (${collation.warnings.length})</summary>` +
      `<ul class="mb-0">${collation.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul></details>`
    : "";
  return (
    `<p class="small text-secondary mb-2">${collation.quires.length} ${collation.quires.length === 1 ? "quire" : "quires"}, ` +
    `${leaves} leaves. Schematic diagram generated from the Gatherings formula: single leaves are drawn ` +
    `in the centre of their quire, since the formula does not record where they sit.</p>` +
    `<div class="small text-secondary mb-3 d-flex align-items-center">${LEGEND}</div>` +
    notes +
    `<div class="cd-grid">${quires}</div>` +
    `<details class="small mt-3"><summary>Formula</summary><div class="text-break mt-1">${escapeHtml(collation.source)}</div></details>` +
    warnings
  );
}

/**
 * Fill and show the collation modal. With `returnTo` (an open modal), that
 * modal is hidden first and shown again, at the same scroll position, when the
 * diagram closes. Bootstrap does not support stacked modals: the lower modal's
 * focus trap pulls focus back, so Escape would close the wrong one.
 */
export function openCollationModal(collation, title, returnTo = null) {
  const modalEl = document.getElementById("collationModal");
  const bs = typeof window !== "undefined" ? window.bootstrap : null;
  if (!modalEl || !collation || !bs || !bs.Modal) return;
  const titleEl = document.getElementById("collationModalLabel");
  if (titleEl) titleEl.textContent = title ? `Collation diagram — ${title}` : "Collation diagram";
  modalEl.querySelector(".modal-body").innerHTML = buildCollationHtml(collation);
  current = { collation, title: title || "" };
  bindDownloads();
  const show = () => bs.Modal.getOrCreateInstance(modalEl).show();

  if (!returnTo || !returnTo.classList.contains("show")) {
    show();
    return;
  }
  const body = returnTo.querySelector(".modal-body");
  const scrollTop = body ? body.scrollTop : 0;
  returnTo.addEventListener("hidden.bs.modal", show, { once: true });
  modalEl.addEventListener("hidden.bs.modal", () => {
    returnTo.addEventListener("shown.bs.modal", () => { if (body) body.scrollTop = scrollTop; }, { once: true });
    bs.Modal.getOrCreateInstance(returnTo).show();
  }, { once: true });
  bs.Modal.getOrCreateInstance(returnTo).hide();
}
