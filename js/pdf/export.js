// PDF export for the details modals. jsPDF is large and only needed on a rare
// click, so it is lazy-imported from a CDN (ESM) the first time. This module reads
// the rendered modal DOM into a plain model; js/pdf/layout.js draws it.

import { normalizeForCompare } from "../util/text.js";
import { layoutPdf, isoTimestamp } from "./layout.js";

let jsPDFPromise = null;
function getJsPDF() {
  if (!jsPDFPromise) {
    jsPDFPromise = import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm").then(
      (m) => m.jsPDF || (m.default && m.default.jsPDF) || m.default
    );
  }
  return jsPDFPromise;
}

const text = (el) => String((el && el.textContent) || "").replace(/ /g, " ").trim();

/**
 * Split a value element into lines: text runs break at <br>, and each link is a
 * line of its own (the "; " separators between links are dropped).
 */
function valueLines(el) {
  const lines = [];
  let buf = "";
  const flush = () => {
    if (normalizeForCompare(buf)) lines.push({ text: buf.trim() });
    buf = "";
  };
  const walk = (node) => {
    if (node.nodeType === 3) {
      if (node.textContent.trim() !== ";") buf += node.textContent;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toUpperCase();
    if (tag === "BR") return flush();
    if (tag === "A") {
      flush();
      if (text(node)) lines.push({ text: text(node), href: node.getAttribute("href") || "" });
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  if (el) for (const child of el.childNodes) walk(child);
  flush();
  return lines;
}

/** Model for the manuscript modal: its sections, header table and field blocks. */
function manuscriptModel(content, title) {
  const sections = [];
  for (const sec of content.querySelectorAll(":scope > .mb-4")) {
    const items = [];
    const table = sec.querySelector("table");
    if (table) {
      for (const tr of table.querySelectorAll("tbody tr")) {
        items.push({ label: text(tr.querySelector("th")), inline: true, muted: true, lines: valueLines(tr.querySelector("td")) });
      }
    }
    for (const block of sec.querySelectorAll(":scope > .mb-3")) {
      const lines = [];
      for (const row of block.querySelectorAll(":scope > .d-flex, :scope > .mb-1")) {
        const isLocusRow = row.classList.contains("d-flex");
        const locus = isLocusRow ? text(row.children[0]) : "";
        const vlines = valueLines(isLocusRow ? row.children[1] : row.querySelector(".text-break"));
        vlines.forEach((l, i) => lines.push(i === 0 && locus ? { ...l, locus } : l));
      }
      items.push({ label: text(block.querySelector(":scope > .fw-bold")), lines });
    }
    sections.push({ title: text(sec.querySelector("h5")), items });
  }
  return { title, sections };
}

/** Model for the Text View row modal: its label/value entries, left column first. */
function rowModel(content) {
  const items = [];
  for (const col of content.querySelectorAll(".col-md-6")) {
    for (const entry of col.querySelectorAll(".mb-2.border-bottom.pb-1")) {
      items.push({ label: text(entry.querySelector(".fw-bold")), lines: valueLines(entry.querySelector(".text-break")) });
    }
  }
  const valueOf = (label) => {
    const it = items.find((i) => i.label === label);
    return it && it.lines[0] ? it.lines[0].text : "";
  };
  const title = [valueOf("Depository"), valueOf("Shelfmark")].filter(Boolean).join(" — ") || "Text details";
  return { title, sections: [{ items }] };
}

async function savePdf(model, filename) {
  let jsPDF;
  try {
    jsPDF = await getJsPDF();
  } catch (e) {
    console.error("Failed to load jsPDF:", e);
    alert("Could not load the PDF library.");
    return;
  }
  const doc = new jsPDF("p", "pt", "a4");
  layoutPdf(doc, model, { accessed: isoTimestamp(new Date()) });
  doc.save(filename);
}

/** Generate and download a PDF for the currently-rendered manuscript modal. */
export async function exportManuscriptPdf(modalEl) {
  const content = (modalEl || document).querySelector("#ms-details-content");
  if (!content) return;
  const filename = (modalEl && modalEl.dataset && modalEl.dataset.filename) || "manuscript.pdf";
  const title = text((modalEl || document).querySelector("#msDetailsModalLabel")) || "Manuscript";
  await savePdf(manuscriptModel(content, title), filename);
}

/** Generate and download a PDF for the Text View row-details modal. */
export async function exportRowDetailsPdf(modalEl) {
  const content = (modalEl || document).querySelector("#row-details-content");
  if (!content) return;
  const filename = (modalEl && modalEl.dataset && modalEl.dataset.filename) || "manuscript-details.pdf";
  await savePdf(rowModel(content), filename);
}
