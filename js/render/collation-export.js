// Download of the collation diagram as a standalone SVG, PNG or PDF. The
// drawing is built from the parsed collation (not scraped from the modal) as a
// list of plain shapes (`collationScene`): title, summary, legend, the quires
// laid out in rows, each quire's note under it, the general notes and the
// formula. The SVG writes those shapes with embedded, fixed light-theme styles
// so the file looks the same outside the app; the PNG is that SVG on a canvas;
// the PDF draws the same shapes with jsPDF as vectors and real (selectable)
// text. Everything but the download functions is DOM-free (tested).

import { escapeHtml, fold } from "../util/text.js";
import { foldPath, hookPath, quireSize, quireShapes, shapesSvg } from "./collation-svg.js";
import { getJsPDF } from "../pdf/export.js";
import { isoTimestamp } from "../pdf/layout.js";
import { saveBlob } from "../util/download.js";

const MARGIN = 24;
const MAX_WIDTH = 960; // content width before quires wrap to a new row
const GAP = 16;
const FONT = "Helvetica, Arial, sans-serif";
const CHAR_W = 6.1; // average glyph width at 12px (Helvetica/Arial), for wrapping
const LINE = 16;

// Light-theme look of each class, shared by the SVG stylesheet and the PDF.
// Lengths are in px; text weight 600 is bold in the PDF.
export const CLASS_STYLE = {
  "cd-band": { fill: "#f8f9fa", stroke: "#dee2e6", width: 1 },
  "cd-leaf": { stroke: "#526c91", width: 2, round: true },
  "cd-single": { stroke: "#b0652f", width: 2, round: true },
  "cd-label": { size: 15, bold: true, color: "#212529" },
  "cd-count": { size: 12, color: "#6c757d" },
  "cd-folio": { size: 12, color: "#6c757d" },
  "cd-small": { size: 12, color: "#6c757d" },
  "cd-title": { size: 18, bold: true, color: "#212529" },
  "cd-body": { size: 12, color: "#212529" },
};

const STYLE = `text{font-family:${FONT}}` + Object.entries(CLASS_STYLE).map(([cls, st]) => {
  const rules = st.size
    ? [`font-size:${st.size}px`, `fill:${st.color}`, st.bold && "font-weight:600"]
    : [`fill:${st.fill || "none"}`, `stroke:${st.stroke}`, `stroke-width:${st.width}`, st.round && "stroke-linecap:round"];
  return `.${cls}{${rules.filter(Boolean).join(";")}}`;
}).join("");

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
  lines.map((text, i) => ({ t: "text", cls, x, y: y + i * LINE, text }));

/**
 * The diagram of a parsed collation (model/collation.js) as
 * {width, height, title, items}, items being shapes as in `shapesSvg`.
 * `opts` draws one page of a paginated export: `quires` a subset of the quires,
 * `notes`/`formula` whether to include those, `continued` marks pages 2+,
 * `minWidth` keeps all pages as wide. The summary counts the whole collation.
 */
export function collationScene(collation, title = "", opts = {}) {
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
  out.push({ t: "text", cls: "cd-title", x: MARGIN, y, text: heading });
  y += 22;
  const summaryLines = wrapText(summary, chars);
  out.push(...textLines(summaryLines, MARGIN, y, "cd-small"));
  y += summaryLines.length * LINE + 4;

  // Legend
  out.push(
    { t: "path", cls: "cd-leaf", segs: foldPath(MARGIN + 38, MARGIN + 10, y + 3, y + 15, 6) },
    { t: "text", cls: "cd-small", x: MARGIN + 44, y: y + 13, text: "bifolium" },
    { t: "path", cls: "cd-single", segs: hookPath(MARGIN + 138, MARGIN + 108, y + 7, 4) },
    { t: "text", cls: "cd-small", x: MARGIN + 144, y: y + 13, text: "single leaf" },
  );
  y += 18 + 12;

  const noteList = notes ? collation.notes : [];
  for (const n of noteList) {
    const lines = wrapText(`• ${n}`, chars);
    out.push(...textLines(lines, MARGIN, y + 12, "cd-body"));
    y += lines.length * LINE;
  }
  if (noteList.length) y += 8;

  for (const c of cells) {
    out.push(quireShapes(c.q, { x: MARGIN + c.x, y: y + c.y }));
    if (c.caption.length) out.push(...textLines(c.caption, MARGIN + c.x, y + c.y + c.height + 4 + 12, "cd-small"));
  }
  y += gridH;

  if (withFormula) {
    const formula = wrapText(`Formula: ${collation.source}`, chars);
    out.push(...textLines(formula, MARGIN, y + 20 + 12, "cd-small"));
    y += 20 + formula.length * LINE;
  }

  return { width: Math.ceil(width + 2 * MARGIN), height: Math.ceil(y + MARGIN), title: heading, items: out };
}

/** Standalone SVG document for a scene from `collationScene`. */
export function sceneSvg(scene) {
  const { width: W, height: H, title, items } = scene;
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style>` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    shapesSvg(items) + `</svg>`;
}

/** Standalone SVG document for a parsed collation (`opts` as in `collationScene`). */
export function collationSvgDocument(collation, title = "", opts = {}) {
  return sceneSvg(collationScene(collation, title, opts));
}

/** Pixel size of an SVG document string from `collationSvgDocument`. */
export function svgSize(svg) {
  const m = /<svg[^>]* width="(\d+)" height="(\d+)"/.exec(svg);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Split the diagram into page-sized scenes (`collationScene`), breaking only
 * between quires. `fits({width, height})` says whether a page's scene fits; a
 * page always gets at least one quire. Notes go on the first page, the formula
 * on the last; all pages are as wide as the whole diagram.
 */
export function collationPages(collation, title, fits) {
  const n = collation.quires.length;
  const minWidth = collationScene(collation, title).width - 2 * MARGIN;
  const make = (i, j, first) => collationScene(collation, title, {
    quires: collation.quires.slice(i, j), notes: first, formula: j === n, continued: !first, minWidth,
  });
  if (!n) return [make(0, 0, true)];
  const pages = [];
  for (let i = 0; i < n;) {
    const first = pages.length === 0;
    let j = i + 1;
    while (j < n && fits(make(i, j + 1, first))) j++;
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

// Characters jsPDF's built-in Helvetica can draw (WinAnsi): printable ASCII,
// Latin-1 and these extras.
const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const winAnsi = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.includes(ch);
};

/**
 * Text as Helvetica in the PDF can draw it: a character outside WinAnsi loses
 * its diacritics when that leaves a drawable letter (ǫ → o, ǿ → ø), otherwise
 * it becomes "?".
 */
export function pdfText(text) {
  return [...String(text)].map((ch) => {
    if (winAnsi(ch)) return ch;
    const base = ch.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
    return base && [...base].every(winAnsi) ? base : "?";
  }).join("");
}

/**
 * Draw a scene (`collationScene`) into a jsPDF document: 1 px becomes `scale`
 * pt and the scene's origin lands at (x0, y0) pt. Shapes are vector paths,
 * text is real text in Helvetica (bold for weight 600).
 */
export function drawScene(doc, scene, { scale, x0 = 0, y0 = 0 }) {
  const X = (x) => x0 + x * scale;
  const Y = (y) => y0 + y * scale;
  for (const it of scene.items) {
    const st = CLASS_STYLE[it.cls] || {};
    if (it.t === "group") {
      drawScene(doc, it, { scale, x0: X(it.x || 0), y0: Y(it.y || 0) });
    } else if (it.t === "rect") {
      doc.setLineWidth(st.width * scale);
      doc.setDrawColor(st.stroke);
      if (st.fill) doc.setFillColor(st.fill);
      const r = (it.rx || 0) * scale;
      doc.roundedRect(X(it.x), Y(it.y), it.w * scale, it.h * scale, r, r, st.fill ? "FD" : "S");
    } else if (it.t === "path") {
      doc.setLineWidth(st.width * scale);
      doc.setDrawColor(st.stroke);
      doc.setLineCap(st.round ? "round" : "butt");
      for (const [c, ...n] of it.segs) {
        if (c === "M") doc.moveTo(X(n[0]), Y(n[1]));
        else if (c === "L") doc.lineTo(X(n[0]), Y(n[1]));
        else if (c === "C") doc.curveTo(X(n[0]), Y(n[1]), X(n[2]), Y(n[3]), X(n[4]), Y(n[5]));
      }
      doc.stroke();
    } else if (it.t === "text") {
      doc.setFont("helvetica", st.bold ? "bold" : "normal");
      doc.setFontSize(st.size * scale);
      doc.setTextColor(st.color);
      doc.text(pdfText(it.text), X(it.x), Y(it.y), {
        align: it.anchor === "end" ? "right" : "left",
        baseline: it.middle ? "middle" : "alphabetic",
      });
    }
  }
}

// PDF page: landscape A4 in pt. The diagram is drawn at most at its natural
// size (1 px = 0.75 pt), smaller when wider than the page. The scene's own
// MARGIN replaces the page margin rather than adding to it.
const PDF = { w: 841.89, h: 595.28, margin: 28, footer: 22, natural: 0.75 };
const pdfScale = (width) => Math.min(PDF.natural, (PDF.w - 2 * PDF.margin) / (width - 2 * MARGIN));
const pdfFits = ({ width, height }) =>
  (height - 2 * MARGIN) * pdfScale(width) <= PDF.h - 2 * PDF.margin - PDF.footer;

/**
 * Write the diagram into a new jsPDF document: landscape A4 pages, each a
 * page-sized part of the diagram (broken between quires) drawn as vectors and
 * text, with an "Accessed" footer and page numbers like the details-modal PDFs.
 */
export function collationPdf(jsPDF, collation, title, date = new Date()) {
  const pages = collationPages(collation, title, pdfFits);
  const doc = new jsPDF("l", "pt", "a4");
  doc.setProperties({ title: pdfText(title ? `Collation diagram — ${title}` : "Collation diagram") });
  const accessed = isoTimestamp(date);
  pages.forEach((scene, i) => {
    if (i > 0) doc.addPage("a4", "l");
    const s = pdfScale(scene.width);
    const at = PDF.margin - MARGIN * s;
    drawScene(doc, scene, { scale: s, x0: at, y0: at });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(108, 117, 125);
    doc.text(`Accessed: ${accessed}`, PDF.margin, PDF.h - 20);
    const label = `Page ${i + 1} of ${pages.length}`;
    doc.text(label, PDF.w - PDF.margin - doc.getTextWidth(label), PDF.h - 20);
  });
  return doc;
}

/** Download the diagram as PDF (see `collationPdf`). */
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
    collationPdf(jsPDF, collation, title).save(collationFilename(title, "pdf"));
  } catch (e) {
    console.error(e);
    alert("Could not create the PDF.");
  }
}
