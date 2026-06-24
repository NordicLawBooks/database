// PDF export for the manuscript details modal. jsPDF is large and only needed on
// a rare click, so it is lazy-imported from a CDN (ESM) the first time. The
// two-column "newspaper" layout + DOM extraction are ported from the legacy app.

import { escapeHtml, normalizeForCompare } from "../util/text.js";

let jsPDFPromise = null;
function getJsPDF() {
  if (!jsPDFPromise) {
    jsPDFPromise = import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm").then(
      (m) => m.jsPDF || (m.default && m.default.jsPDF) || m.default
    );
  }
  return jsPDFPromise;
}

// Pull labelled items out of the modal DOM (header table rows + segment blocks).
function extractItems(root) {
  const out = [];
  for (const sec of root.querySelectorAll(":scope > .mb-4")) {
    const table = sec.querySelector("table");
    if (table) {
      for (const tr of table.querySelectorAll("tbody tr")) {
        const th = tr.querySelector("th");
        const td = tr.querySelector("td");
        const label = th ? String(th.textContent || "").trim() : "";
        const valueHtml = td ? String(td.innerHTML || "").trim() : "";
        if (label || valueHtml) out.push({ label, valueHtml });
      }
      continue;
    }
    for (const b of sec.querySelectorAll(".mb-3")) {
      const bt = b.querySelector(".fw-bold");
      const blockTitle = bt ? String(bt.textContent || "").trim() : "";

      const lines = Array.from(b.querySelectorAll(":scope > .d-flex"));
      if (lines.length) {
        const combined = [];
        for (const line of lines) {
          const divs = line.querySelectorAll(":scope > div");
          const locusText = divs[0] ? String(divs[0].textContent || "").trim() : "";
          const valueHtml = divs[1] ? String(divs[1].innerHTML || "").trim() : "";
          const merged = locusText ? `${escapeHtml(locusText)} ${valueHtml}` : valueHtml;
          if (normalizeForCompare(merged)) combined.push(merged);
        }
        if (combined.length) out.push({ label: blockTitle, valueHtml: combined.join("<br/>") });
        continue;
      }

      const plain = Array.from(b.querySelectorAll(":scope > .mb-1 > .text-break"))
        .map((pl) => String(pl.innerHTML || "").trim())
        .filter((v) => normalizeForCompare(v));
      if (plain.length) {
        out.push({ label: blockTitle, valueHtml: plain.join("<br/>") });
        continue;
      }

      const rest = String(b.textContent || "").trim();
      if (blockTitle && rest) out.push({ label: blockTitle, valueHtml: escapeHtml(rest) });
    }
  }
  return out;
}

/** Generate and download a PDF for the currently-rendered manuscript modal. */
export async function exportManuscriptPdf(modalEl) {
  const content = (modalEl || document).querySelector("#ms-details-content");
  if (!content) return;
  const filename = (modalEl && modalEl.dataset && modalEl.dataset.filename) || "manuscript.pdf";

  let jsPDF;
  try {
    jsPDF = await getJsPDF();
  } catch (e) {
    console.error("Failed to load jsPDF:", e);
    alert("Could not load the PDF library.");
    return;
  }

  const doc = new jsPDF("p", "pt", "a4");
  const marginX = 40, marginY = 60;
  const pageWidth = doc.internal.pageSize.getWidth();
  const colGap = 30;
  const colWidth = Math.max(140, (pageWidth - marginX * 2 - colGap) / 2);
  const startY = marginY + 20;
  const startYNoHeader = 40;
  const lineHeight = 14;
  const brGap = 0;
  const itemGap = 4;
  const maxY = doc.internal.pageSize.getHeight() - 60;
  const dateStr = new Date().toLocaleString();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(40);
  doc.text("NordicLaw Manuscripts", marginX, marginY);

  const items = extractItems(content);
  const startYForPage = (page) => (page === 1 ? startY : startYNoHeader);
  const xForCol = (col) => (col === 0 ? marginX : marginX + colWidth + colGap);
  const state = { page: 1, col: 0, yPos: startYForPage(1) };

  const advance = () => {
    if (state.col === 0) {
      state.col = 1;
      state.yPos = startYForPage(state.page);
    } else {
      doc.addPage();
      state.page += 1;
      state.col = 0;
      state.yPos = startYForPage(state.page);
    }
  };
  const ensureSpace = (h) => {
    if (state.yPos + h > maxY) advance();
  };

  const emitText = (txt) => {
    const s = String(txt || "").replace(/ /g, " ");
    for (const part of s.split(/\n/)) {
      const t = part.replace(/\s+/g, " ").trimEnd();
      if (!t.trim()) {
        ensureSpace(lineHeight);
        state.yPos += lineHeight;
        continue;
      }
      doc.setFont("times", "normal");
      doc.setFontSize(10);
      doc.setTextColor(33, 37, 41);
      for (const ln of doc.splitTextToSize(t, colWidth)) {
        ensureSpace(lineHeight);
        doc.text(ln, xForCol(state.col), state.yPos);
        state.yPos += lineHeight;
      }
    }
  };

  const emitLink = (linkText, href) => {
    const t = String(linkText || "").trim();
    if (!t) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(13, 110, 253);
    const lines = doc.splitTextToSize(t, colWidth);
    ensureSpace(lineHeight);
    doc.textWithLink(lines[0] || t, xForCol(state.col), state.yPos, { url: href || "" });
    state.yPos += lineHeight;
    if (lines.length > 1) {
      doc.setFont("times", "normal");
      doc.setFontSize(10);
      doc.setTextColor(33, 37, 41);
      for (let i = 1; i < lines.length; i++) {
        ensureSpace(lineHeight);
        doc.text(lines[i], xForCol(state.col), state.yPos);
        state.yPos += lineHeight;
      }
    }
  };

  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      const trimmed = String(node.textContent || "").replace(/ /g, " ").trim();
      if (trimmed === ";") return; // skip the "; " separators between links
      if (trimmed) emitText(node.textContent || "");
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = String(node.tagName || "").toUpperCase();
    if (tag === "BR") {
      if (brGap > 0) ensureSpace(brGap);
      state.yPos += brGap;
      return;
    }
    if (tag === "A") {
      emitLink(node.textContent || "", node.getAttribute("href"));
      return;
    }
    for (const child of Array.from(node.childNodes || [])) walk(child);
  };

  for (const item of items) {
    const label = item.label ? String(item.label) : "";
    const valueHtml = item.valueHtml ? String(item.valueHtml) : "";
    if (!label && !valueHtml) continue;

    doc.setFont("times", "bold");
    doc.setFontSize(8);
    doc.setTextColor(108, 117, 125);
    const labelCaps = label ? label.toUpperCase() : "";
    const labelDims = doc.getTextDimensions(labelCaps, { maxWidth: colWidth });
    ensureSpace((labelDims.h || 12) + 2 + lineHeight);
    doc.text(labelCaps, xForCol(state.col), state.yPos, { maxWidth: colWidth });
    state.yPos += (labelDims.h || 12) + 2;

    const tmp = document.createElement("div");
    tmp.innerHTML = valueHtml || "";
    for (const child of Array.from(tmp.childNodes || [])) walk(child);

    state.yPos += itemGap;
  }

  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    doc.setPage(i);
    doc.setFont("helvetica");
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Accessed: ${dateStr}`, marginX, pageHeight - 20);
  }

  doc.save(filename);
}

/** Generate and download a PDF for the Text View row-details modal. */
export async function exportRowDetailsPdf(modalEl) {
  const content = (modalEl || document).querySelector("#row-details-content");
  if (!content) return;
  const filename = (modalEl && modalEl.dataset && modalEl.dataset.filename) || "manuscript-details.pdf";

  let jsPDF;
  try {
    jsPDF = await getJsPDF();
  } catch (e) {
    console.error("Failed to load jsPDF:", e);
    alert("Could not load the PDF library.");
    return;
  }

  const doc = new jsPDF("p", "pt", "a4");
  const marginX = 40, marginY = 60, colGap = 30;
  const colWidth = (515 - colGap) / 2;
  const lineHeight = 18;
  const maxY = doc.internal.pageSize.getHeight() - 60;
  const startY = marginY + 20;

  const drawHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(40);
    doc.text("NordicLaw Manuscripts", marginX, marginY);
  };

  const cols = content.querySelectorAll(".col-md-6");
  let items = [];
  if (cols.length === 2) {
    items = [
      ...Array.from(cols[0].querySelectorAll(".mb-2.border-bottom.pb-1")),
      ...Array.from(cols[1].querySelectorAll(".mb-2.border-bottom.pb-1")),
    ];
  }

  let colIndex = 0;
  let yPos = startY;
  const xForCol = (i) => (i === 0 ? marginX : marginX + colWidth + colGap);
  const nextColumnOrPage = () => {
    if (colIndex === 0) {
      colIndex = 1;
      yPos = startY;
    } else {
      doc.addPage();
      drawHeader();
      colIndex = 0;
      yPos = startY;
    }
  };
  const ensureSpace = (h) => {
    if (yPos + h > maxY) nextColumnOrPage();
  };
  const drawWrapped = (font, style, size, rgb, text) => {
    const s = String(text || "").replace(/ /g, " ").trim();
    if (!s) return;
    doc.setFont(font, style);
    doc.setFontSize(size);
    doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    for (const ln of doc.splitTextToSize(s, colWidth)) {
      ensureSpace(lineHeight);
      doc.text(ln, xForCol(colIndex), yPos);
      yPos += lineHeight;
    }
  };
  const drawLink = (text, href) => {
    const s = String(text || "").replace(/ /g, " ").trim();
    if (!s) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(13, 110, 253);
    const lines = doc.splitTextToSize(s, colWidth);
    ensureSpace(lineHeight);
    doc.textWithLink(lines[0], xForCol(colIndex), yPos, { url: href || "" });
    yPos += lineHeight;
    if (lines.length > 1) drawWrapped("times", "normal", 10, [33, 37, 41], lines.slice(1).join(" "));
  };
  const drawValueHtml = (valueHtml) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = valueHtml || "";
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 3) {
        const trimmed = String(node.textContent || "").replace(/ /g, " ").trim();
        if (trimmed === ";") return;
        if (trimmed) drawWrapped("times", "normal", 10, [33, 37, 41], node.textContent || "");
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = String(node.tagName || "").toUpperCase();
      if (tag === "BR") {
        ensureSpace(lineHeight);
        yPos += lineHeight;
        return;
      }
      if (tag === "A") {
        drawLink(node.textContent || "", node.getAttribute("href"));
        return;
      }
      for (const child of Array.from(node.childNodes || [])) walk(child);
    };
    if (tmp.querySelector("a")) {
      for (const node of Array.from(tmp.childNodes || [])) walk(node);
    } else {
      drawWrapped("times", "normal", 10, [33, 37, 41], tmp.textContent || "");
    }
  };

  drawHeader();
  for (const div of items) {
    const labelDiv = div.querySelector(".fw-bold");
    const valueDiv = div.querySelector(".text-break");
    const label = labelDiv ? labelDiv.textContent.trim() : "";
    const valueHtml = valueDiv ? valueDiv.innerHTML.trim() : "";
    if (!label && !valueHtml) continue;

    ensureSpace(14 + lineHeight + 8);
    doc.setFont("times", "bold");
    doc.setFontSize(8);
    doc.setTextColor(108, 117, 125);
    const labelCaps = label ? label.toUpperCase() : "";
    const labelDims = doc.getTextDimensions(labelCaps, { maxWidth: colWidth });
    ensureSpace((labelDims.h || 12) + 4);
    doc.text(labelCaps, xForCol(colIndex), yPos, { maxWidth: colWidth });
    yPos += (labelDims.h || 12) + 4;

    drawValueHtml(valueHtml);
    yPos += 8;
  }

  const dateStr = new Date().toLocaleString();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    doc.setPage(i);
    doc.setFont("helvetica");
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Accessed: ${dateStr}`, marginX, pageHeight - 20);
  }
  doc.save(filename);
}
