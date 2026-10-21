// Two-column ("newspaper") PDF layout for the details modals, kept free of the DOM
// so it can be tested against a fake jsPDF. The typography follows the modals:
// sans-serif throughout, section headings, header facts as label | value rows,
// field labels in sentence case above their values, and loci in a grey column
// beside the text.
//
// Input model (built from the modal DOM by export.js):
//   { title, sections: [{ title?, items: [{ label, inline?, muted?, lines }] }] }
//   line: { text, href?, locus? }   (href → a link; locus → grey left column)

const FONT = "helvetica";
const DARK = [33, 37, 41];
const MUTED = [108, 117, 125];
const LINK = [13, 110, 253];
const RULE = [222, 226, 230];

export const PDF_STYLE = {
  margin: 48,
  bottom: 56,
  colGap: 28,
  brand: { size: 9 },
  title: { size: 15, leading: 19 },
  section: { size: 12, leading: 16, before: 12, after: 4 },
  label: { size: 9, leading: 12, after: 4 },
  value: { size: 10, leading: 13.5 },
  locus: { size: 8.5, width: 60 },
  inlineLabelWidth: 72,
  inlineRowPad: 3,
  lineGap: 1.5, // between the lines of one field
  itemGap: 10, // after a field
  footer: { size: 8 },
};

/** Local date and time as ISO 8601 "YYYY-MM-DD HH:MM" (24-hour), for the footer. */
export function isoTimestamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

// Baseline of a line of `size` pt whose box starts at `top`.
const baseline = (top, size) => top + size * 0.78;
const clean = (s) => String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

/**
 * Draw `model` onto a fresh jsPDF `doc` (A4, pt). Returns the number of pages.
 * @param {object} doc  jsPDF instance (or a compatible fake in tests)
 * @param {{title:string, sections:object[]}} model
 * @param {{accessed?: string}} [opts]
 */
export function layoutPdf(doc, model, opts = {}) {
  const S = PDF_STYLE;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const colW = (pageW - S.margin * 2 - S.colGap) / 2;
  const maxY = pageH - S.bottom;
  const title = clean(model.title);

  const font = (style, size, rgb) => {
    doc.setFont(FONT, style);
    doc.setFontSize(size);
    doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  };

  // Page 1: brand line + title across both columns, then a rule.
  let y = S.margin;
  font("normal", S.brand.size, MUTED);
  doc.text("NordicLaw Database", S.margin, baseline(y, S.brand.size));
  y += S.brand.size + 8;
  font("bold", S.title.size, DARK);
  for (const ln of doc.splitTextToSize(title, pageW - S.margin * 2)) {
    doc.text(ln, S.margin, baseline(y, S.title.size));
    y += S.title.leading;
  }
  y += 6;
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.setLineWidth(0.75);
  doc.line(S.margin, y, pageW - S.margin, y);
  y += 14;

  const pos = { page: 1, col: 0, top: y, y };
  const x0 = () => S.margin + pos.col * (colW + S.colGap);
  const atColumnTop = () => pos.y === pos.top;
  const nextColumn = () => {
    if (pos.col === 0) {
      pos.col = 1;
    } else {
      doc.addPage();
      pos.page += 1;
      pos.col = 0;
      pos.top = S.margin + 14; // below the running header
    }
    pos.y = pos.top;
  };
  const ensure = (h) => {
    if (pos.y + h > maxY && !atColumnTop()) nextColumn();
  };

  // One value (text or link), wrapped to width w, `dx` in from the column's left edge.
  // The x is taken per line: a value can continue in the next column.
  const valueLines = (line, w) => {
    font("normal", S.value.size, line.href ? LINK : DARK);
    return doc.splitTextToSize(clean(line.text), w);
  };
  const drawValue = (line, dx, w) => {
    const lines = valueLines(line, w);
    lines.forEach((ln, i) => {
      if (i > 0) ensure(S.value.leading);
      const x = x0() + dx;
      const by = baseline(pos.y, S.value.size);
      font("normal", S.value.size, line.href ? LINK : DARK);
      if (line.href) doc.textWithLink(ln, x, by, { url: line.href });
      else doc.text(ln, x, by);
      pos.y += S.value.leading;
    });
  };

  const drawInlineItem = (item) => {
    const lw = S.inlineLabelWidth;
    const text = item.lines.map((l) => clean(l.text)).filter(Boolean).join("; ");
    const vlines = valueLines({ text }, colW - lw);
    ensure(S.inlineRowPad * 2 + vlines.length * S.value.leading);
    pos.y += S.inlineRowPad;
    font("bold", S.label.size, item.muted ? MUTED : DARK);
    doc.text(clean(item.label), x0(), baseline(pos.y, S.value.size));
    font("normal", S.value.size, DARK);
    for (const ln of vlines) {
      doc.text(ln, x0() + lw, baseline(pos.y, S.value.size));
      pos.y += S.value.leading;
    }
    pos.y += S.inlineRowPad;
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.setLineWidth(0.5);
    doc.line(x0(), pos.y, x0() + colW, pos.y);
  };

  const drawItem = (item) => {
    const hasLocus = item.lines.some((l) => clean(l.locus));
    // Keep the label with the first value line.
    ensure(S.label.leading + S.label.after + S.value.leading);
    if (item.label) {
      font("bold", S.label.size, item.muted ? MUTED : DARK);
      doc.text(clean(item.label), x0(), baseline(pos.y, S.label.size));
      pos.y += S.label.leading + S.label.after;
    }
    item.lines.forEach((line, i) => {
      if (i > 0) pos.y += S.lineGap;
      ensure(S.value.leading);
      if (hasLocus) {
        const locus = clean(line.locus);
        if (locus) {
          font("normal", S.locus.size, MUTED);
          doc.text(locus, x0(), baseline(pos.y, S.value.size), { maxWidth: S.locus.width - 4 });
        }
        drawValue(line, S.locus.width, colW - S.locus.width);
      } else {
        drawValue(line, 0, colW);
      }
    });
    pos.y += S.itemGap;
  };

  for (const section of model.sections || []) {
    const items = (section.items || []).filter((it) => it.lines && it.lines.some((l) => clean(l.text)));
    if (!items.length) continue;
    if (section.title) {
      if (!atColumnTop()) pos.y += S.section.before;
      ensure(S.section.leading + S.section.after + S.label.leading + S.value.leading);
      font("normal", S.section.size, DARK);
      doc.text(clean(section.title), x0(), baseline(pos.y, S.section.size));
      pos.y += S.section.leading + S.section.after;
    }
    for (const item of items) {
      if (item.inline) drawInlineItem(item);
      else drawItem(item);
    }
  }

  // Running header (pages 2+) and footer (all pages).
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    font("normal", S.footer.size, MUTED);
    if (i > 1) doc.text(title, S.margin, S.margin - 8, { maxWidth: pageW - S.margin * 2 });
    if (opts.accessed) doc.text(`Accessed: ${opts.accessed}`, S.margin, pageH - 24);
    const label = `Page ${i} of ${pages}`;
    doc.text(label, pageW - S.margin - doc.getTextWidth(label), pageH - 24);
  }
  return pages;
}
