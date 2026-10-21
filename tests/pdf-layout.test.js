import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutPdf, PDF_STYLE, isoTimestamp } from "../js/pdf/layout.js";

// A jsPDF stand-in (A4, pt) that records every text draw. Widths are approximated
// as 0.5em per character, which is enough to exercise wrapping and flow.
function fakeDoc() {
  const ops = [];
  let page = 1;
  let pages = 1;
  let size = 10;
  let style = "normal";
  const width = (s) => String(s).length * size * 0.5;
  return {
    ops,
    internal: { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 } },
    setFont: (_f, s) => { style = s; },
    setFontSize: (s) => { size = s; },
    setTextColor() {},
    setDrawColor() {},
    setLineWidth() {},
    line() {},
    getTextWidth: width,
    splitTextToSize(text, w) {
      const out = [];
      let cur = "";
      for (const word of String(text).split(" ")) {
        const next = cur ? `${cur} ${word}` : word;
        if (cur && width(next) > w) { out.push(cur); cur = word; } else cur = next;
      }
      if (cur) out.push(cur);
      return out;
    },
    text: (str, x, y) => ops.push({ str, x, y, size, style, page }),
    textWithLink: (str, x, y, o) => ops.push({ str, x, y, size, style, page, url: o.url }),
    addPage: () => { pages += 1; page = pages; },
    setPage: (p) => { page = p; },
    getNumberOfPages: () => pages,
  };
}

const find = (doc, str) => doc.ops.find((o) => o.str === str);

test("layoutPdf leaves clear space between a field label and its value", () => {
  const doc = fakeDoc();
  layoutPdf(doc, { title: "KB — Holm B 1", sections: [{ title: "Content", items: [{ label: "Main text", lines: [{ text: "Upplandslagen" }] }] }] });
  const label = find(doc, "Main text");
  const value = find(doc, "Upplandslagen");
  assert.equal(label.style, "bold");
  assert.ok(value.y - label.y >= 15, `label→value baseline gap ${value.y - label.y}pt`);
  assert.equal(value.x, label.x);
});

test("layoutPdf puts loci in a column beside the text and draws links as links", () => {
  const doc = fakeDoc();
  layoutPdf(doc, {
    title: "T",
    sections: [{ items: [
      { label: "Script", lines: [{ locus: "ff. 1r-7v", text: "Protogothic" }] },
      { label: "Links", lines: [{ text: "Handrit.is", href: "https://handrit.is/x" }] },
    ] }],
  });
  const locus = find(doc, "ff. 1r-7v");
  const value = find(doc, "Protogothic");
  assert.equal(value.x - locus.x, PDF_STYLE.locus.width);
  assert.equal(locus.y, value.y);
  assert.equal(find(doc, "Handrit.is").url, "https://handrit.is/x");
});

test("layoutPdf flows into the second column and onto new pages within the margins", () => {
  const doc = fakeDoc();
  const items = Array.from({ length: 80 }, (_, i) => ({ label: `Field ${i}`, lines: [{ text: `Value ${i}` }] }));
  const pages = layoutPdf(doc, { title: "Long", sections: [{ title: "Content", items }] }, { accessed: "today" });
  assert.ok(pages >= 2);
  const maxY = 841.89 - PDF_STYLE.bottom;
  for (const op of doc.ops) {
    if (op.str.startsWith("Field") || op.str.startsWith("Value")) assert.ok(op.y <= maxY, `${op.str} at ${op.y}`);
  }
  const xs = new Set(doc.ops.filter((o) => o.str.startsWith("Field") && o.page === 1).map((o) => o.x));
  assert.equal(xs.size, 2); // both columns used on page 1
  assert.ok(find(doc, `Page ${pages} of ${pages}`));
  assert.ok(find(doc, "Accessed: today"));
});

test("layoutPdf continues a value that overflows a column in the next column, without overlaps", () => {
  const doc = fakeDoc();
  const filler = Array.from({ length: 22 }, (_, i) => ({ label: `Field ${i}`, lines: [{ text: `Value ${i}` }] }));
  const long = { label: "Iconography", lines: [{ text: Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ") }] };
  layoutPdf(doc, {
    title: "T",
    sections: [{ title: "Physical Description", items: [...filler, long] }, { title: "Bibliography", items: [{ label: "Links", lines: [{ text: "Handrit.is", href: "h" }] }] }],
  });
  const body = doc.ops.filter((o) => o.str !== "T" && !o.str.startsWith("Page ") && o.str !== "NordicLaw Database");
  const colXs = [PDF_STYLE.margin, PDF_STYLE.margin + (595.28 - PDF_STYLE.margin * 2 - PDF_STYLE.colGap) / 2 + PDF_STYLE.colGap];
  // In drawing order, each page fills the left column top to bottom, then the right.
  let last = null;
  for (const op of body) {
    const col = colXs.findIndex((x) => Math.abs(op.x - x) < 0.01);
    assert.ok(col !== -1, `${op.str} at x=${op.x}`);
    if (last && last.page === op.page) {
      assert.ok(col > last.col || (col === last.col && op.y > last.y), `"${op.str}" (page ${op.page}, column ${col + 1}) drawn out of order`);
    }
    last = { page: op.page, col, y: op.y };
  }
  assert.ok(new Set(body.map((o) => o.page)).size >= 2); // the long value did cross onto a new page
});

test("isoTimestamp formats local time as YYYY-MM-DD HH:MM", () => {
  assert.equal(isoTimestamp(new Date(2026, 0, 5, 9, 7, 59)), "2026-01-05 09:07");
  assert.equal(isoTimestamp(new Date(2026, 11, 31, 23, 59)), "2026-12-31 23:59");
});
