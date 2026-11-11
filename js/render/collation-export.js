// Download of the collation diagram as a standalone SVG, PNG or PDF. The SVG is
// built from the parsed collation (not scraped from the modal): title, summary,
// legend, the quires laid out in rows, each quire's note under it, the general
// notes and the formula. Styles are embedded with fixed light-theme colours so
// the file looks the same outside the app. `collationSvgDocument` and
// `collationPages`/`collationFilename` are DOM-free (tested); the download functions need a
// browser.

import { escapeHtml, fold } from "../util/text.js";
import { quireSize, quireSvg } from "./collation-svg.js";
import { getJsPDF } from "../pdf/export.js";
import { isoTimestamp } from "../pdf/layout.js";

const MARGIN = 24;
const MAX_WIDTH = 960; // content width before quires wrap to a new row
const GAP = 16;
const FONT = "Helvetica, Arial, sans-serif";
const CHAR_W = 6.1; // average glyph width at 12px (Helvetica/Arial), for wrapping
const LINE = 16;

const STYLE =
  `text{font-family:${FONT}}` +
  `.cd-band{fill:#f8f9fa;stroke:#dee2e6}` +
  `.cd-leaf,.cd-single{fill:none;stroke-width:2;stroke-linecap:round}` +
  `.cd-leaf{stroke:#526c91}.cd-single{stroke:#b0652f}` +
  `.cd-label{font-weight:600;font-size:15px;fill:#212529}` +
  `.cd-count,.cd-folio,.cd-small{font-size:12px;fill:#6c757d}` +
  `.cd-title{font-weight:600;font-size:18px;fill:#212529}` +
  `.cd-body{font-size:12px;fill:#212529}`;

/** Greedy word wrap to at most `maxChars` per line (long words are kept whole). */
export function wrapText(text, maxChars) {
  const lines = [];
  let line = "";
  for (const word of String(text || "").split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const textLines = (lines, x, y, cls) =>
  lines.map((l, i) => `<text class="${cls}" x="${x}" y="${y + i * LINE}">${escapeHtml(l)}</text>`).join("");

/**
 * Standalone SVG document for a parsed collation (model/collation.js).
 * `opts` draws one page of a paginated export: `quires` a subset of the quires,
 * `notes`/`formula` whether to include those, `continued` marks pages 2+,
 * `minWidth` keeps all pages as wide. The summary counts the whole collation.
 */
export function collationSvgDocument(collation, title = "", opts = {}) {
  const { quires = collation.quires, notes = true, formula: withFormula = true, continued = false, minWidth = 0 } = opts;
  const heading = (title ? `Collation diagram — ${title}` : "Collation diagram") + (continued ? " (continued)" : "");
  const leaves = collation.quires.reduce((sum, q) => sum + q.count, 0);
  const nq = collation.quires.length;
  const summary = `${nq} ${nq === 1 ? "quire" : "quires"}, ${leaves} leaves. ` +
    "Schematic diagram generated from the Gatherings formula; single leaves are drawn in the centre of their quire.";

  // Lay the quires out in rows, wrapping at MAX_WIDTH.
  const cells = quires.map((q) => {
    const size = quireSize(q);
    const caption = q.note ? wrapText(q.note, Math.max(Math.floor(size.width / CHAR_W), 20)) : [];
    return { q, ...size, caption, h: size.height + (caption.length ? 4 + caption.length * LINE : 0) };
  });
  let x = 0;
  let rowTop = 0;
  let rowH = 0;
  let gridW = 0;
  for (const c of cells) {
    if (x > 0 && x + c.width > MAX_WIDTH) {
      rowTop += rowH + GAP;
      x = 0;
      rowH = 0;
    }
    c.x = x;
    c.y = rowTop;
    x += c.width + GAP;
    rowH = Math.max(rowH, c.h);
    gridW = Math.max(gridW, c.x + c.width);
  }
  const gridH = cells.length ? rowTop + rowH : 0;

  const width = Math.max(gridW, Math.min(MAX_WIDTH, Math.ceil(heading.length * 10)), 480, minWidth);
  const chars = Math.floor(width / CHAR_W);
  const out = [];
  let y = MARGIN + 18;
  out.push(`<text class="cd-title" x="${MARGIN}" y="${y}">${escapeHtml(heading)}</text>`);
  y += 22;
  const summaryLines = wrapText(summary, chars);
  out.push(textLines(summaryLines, MARGIN, y, "cd-small"));
  y += summaryLines.length * LINE + 4;

  // Legend
  out.push(
    `<g transform="translate(${MARGIN} ${y})">` +
    `<path class="cd-leaf" d="M38 3H10A6 6 0 0 0 10 15H38"/>` +
    `<text class="cd-small" x="44" y="13">bifolium</text>` +
    `<path class="cd-single" d="M138 7H108q-4 0 -4 4"/>` +
    `<text class="cd-small" x="144" y="13">single leaf</text></g>`
  );
  y += 18 + 12;

  const noteList = notes ? collation.notes : [];
  for (const n of noteList) {
    const lines = wrapText(`• ${n}`, chars);
    out.push(textLines(lines, MARGIN, y + 12, "cd-body"));
    y += lines.length * LINE;
  }
  if (noteList.length) y += 8;

  for (const c of cells) {
    out.push(quireSvg(c.q, { x: MARGIN + c.x, y: y + c.y }));
    if (c.caption.length) out.push(textLines(c.caption, MARGIN + c.x, y + c.y + c.height + 4 + 12, "cd-small"));
  }
  y += gridH;

  if (withFormula) {
    const formula = wrapText(`Formula: ${collation.source}`, chars);
    out.push(textLines(formula, MARGIN, y + 20 + 12, "cd-small"));
    y += 20 + formula.length * LINE;
  }

  const W = Math.ceil(width + 2 * MARGIN);
  const H = Math.ceil(y + MARGIN);
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<title>${escapeHtml(heading)}</title><style>${STYLE}</style>` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    out.join("") + `</svg>`;
}

/** Pixel size of an SVG document string from `collationSvgDocument`. */
export function svgSize(svg) {
  const m = /<svg[^>]* width="(\d+)" height="(\d+)"/.exec(svg);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Split the diagram into page-sized SVG documents, breaking only between
 * quires. `fits({width, height})` says whether a page's SVG fits; a page always
 * gets at least one quire. Notes go on the first page, the formula on the last.
 */
export function collationPages(collation, title, fits) {
  const n = collation.quires.length;
  const minWidth = svgSize(collationSvgDocument(collation, title)).width - 2 * MARGIN;
  const make = (i, j, first) => collationSvgDocument(collation, title, {
    quires: collation.quires.slice(i, j), notes: first, formula: j === n, continued: !first, minWidth,
  });
  if (!n) return [make(0, 0, true)];
  const pages = [];
  for (let i = 0; i < n;) {
    const first = pages.length === 0;
    let j = i + 1;
    while (j < n && fits(svgSize(make(i, j + 1, first)))) j++;
    pages.push(make(i, j, first));
    i = j;
  }
  return pages;
}

/** File name for a download: "collation-<title>.<ext>", folded to lower-case ASCII. */
export function collationFilename(title, ext) {
  const slug = fold(title || "")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/\.+(?=-|$)/g, "")
    .replace(/^-+|-+$/g, "");
  return `collation${slug ? `-${slug}` : ""}.${ext}`;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download the diagram as SVG. */
export function downloadCollationSvg(collation, title) {
  const svg = collationSvgDocument(collation, title);
  saveBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), collationFilename(title, "svg"));
}

/** Draw an SVG document string onto a canvas at `scale` device pixels per px. */
async function svgToCanvas(svg, scale) {
  const { width, height } = svgSize(svg);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Could not render the collation diagram"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Download the diagram as PNG, rendered from the SVG at 2× scale. */
export async function downloadCollationPng(collation, title, scale = 2) {
  try {
    const canvas = await svgToCanvas(collationSvgDocument(collation, title), scale);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not encode the PNG");
    saveBlob(blob, collationFilename(title, "png"));
  } catch (e) {
    console.error(e);
    alert("Could not create the PNG image.");
  }
}

// PDF page: landscape A4 in pt. The diagram is drawn at most at its natural
// size (1 px = 0.75 pt), smaller when wider than the page. The SVG's own white
// MARGIN replaces the page margin rather than adding to it.
const PDF = { w: 841.89, h: 595.28, margin: 28, footer: 22, natural: 0.75, dpiScale: 3 };
const pdfScale = (width) => Math.min(PDF.natural, (PDF.w - 2 * PDF.margin) / (width - 2 * MARGIN));
const pdfFits = ({ width, height }) =>
  (height - 2 * MARGIN) * pdfScale(width) <= PDF.h - 2 * PDF.margin - PDF.footer;

/**
 * Download the diagram as PDF: landscape A4 pages, each a rendered image of a
 * page-sized part of the diagram (broken between quires), with an "Accessed"
 * footer and page numbers like the details-modal PDFs.
 */
export async function downloadCollationPdf(collation, title) {
  let jsPDF;
  try {
    jsPDF = await getJsPDF();
  } catch (e) {
    console.error("Failed to load jsPDF:", e);
    alert("Could not load the PDF library.");
    return;
  }
  try {
    const pages = collationPages(collation, title, pdfFits);
    const doc = new jsPDF("l", "pt", "a4");
    doc.setProperties({ title: title ? `Collation diagram — ${title}` : "Collation diagram" });
    const accessed = isoTimestamp(new Date());
    for (let i = 0; i < pages.length; i++) {
      if (i > 0) doc.addPage("a4", "l");
      const { width, height } = svgSize(pages[i]);
      const canvas = await svgToCanvas(pages[i], PDF.dpiScale);
      const s = pdfScale(width);
      const at = PDF.margin - MARGIN * s;
      doc.addImage(canvas, "PNG", at, at, width * s, height * s, undefined, "FAST");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(108, 117, 125);
      doc.text(`Accessed: ${accessed}`, PDF.margin, PDF.h - 20);
      const label = `Page ${i + 1} of ${pages.length}`;
      doc.text(label, PDF.w - PDF.margin - doc.getTextWidth(label), PDF.h - 20);
    }
    doc.save(collationFilename(title, "pdf"));
  } catch (e) {
    console.error(e);
    alert("Could not create the PDF.");
  }
}
