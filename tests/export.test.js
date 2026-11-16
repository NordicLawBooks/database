import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync, deflateRawSync } from "node:zlib";
import { cleanCell, exportMatrix, toTsv, exportFilename } from "../js/export/table.js";
import { columnLetter, crc32, xmlEscape, xlsxParts, zip, buildXlsx, rangeRef } from "../js/export/xlsx.js";
import { groupedSheet } from "../js/export/grouped.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

test("cleanCell flattens tabs and line breaks, trims, blanks nullish", () => {
  assert.equal(cleanCell(" a\tb\r\nc "), "a b c");
  assert.equal(cleanCell(null), "");
  assert.equal(cleanCell(undefined), "");
  assert.equal(cleanCell(12), "12");
});

test("exportMatrix: titled header, one row per record in column order", () => {
  const rows = [{ "Shelf mark": "AM 1", Name: "Book", Extra: "x" }, { "Shelf mark": "B 2" }];
  assert.deepEqual(exportMatrix(rows, ["Shelf mark", "Name"]), [
    ["Shelfmark", "Name"],
    ["AM 1", "Book"],
    ["B 2", ""],
  ]);
});

test("toTsv joins with tabs and LF, trailing newline", () => {
  assert.equal(toTsv([["a", "b"], ["ǫ", "c\td"]]), "a\tb\nǫ\tc d\n");
});

test("exportFilename names the view and the day", () => {
  const d = new Date(2026, 0, 5);
  assert.equal(exportFilename("merged", "xlsx", d), "nordiclaw-manuscripts-2026-01-05.xlsx");
  assert.equal(exportFilename("units", "tsv", d), "nordiclaw-production-units-2026-01-05.tsv");
  assert.equal(exportFilename("table", "tsv", d), "nordiclaw-texts-2026-01-05.tsv");
});

test("columnLetter", () => {
  assert.deepEqual([0, 25, 26, 27, 51, 52, 701, 702].map(columnLetter), ["A", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
});

test("crc32 check value", () => {
  assert.equal(crc32(enc.encode("123456789")), 0xcbf43926);
});

test("xmlEscape escapes markup and drops XML-invalid characters", () => {
  assert.equal(xmlEscape(`<a href="x">&</a>\u0001`), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  assert.equal(xmlEscape("ǫ 😀"), "ǫ 😀");
});

test("worksheet: bold header, inline strings, frozen row, autofilter over the data", () => {
  const sheet = xlsxParts([["Shelfmark", "Name"], ["AM 1 & 2", ""], ["B", "ǿ"]], "R")["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<dimension ref="A1:B3"\/>/);
  assert.match(sheet, /<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Shelfmark<\/t>/);
  assert.match(sheet, /<c r="A2" t="inlineStr" s="2"><is><t xml:space="preserve">AM 1 &amp; 2<\/t>/);
  assert.doesNotMatch(sheet, /r="B2"/); // empty cells are omitted
  assert.match(sheet, /<c r="B3" t="inlineStr" s="2"><is><t xml:space="preserve">ǿ<\/t>/);
  assert.match(sheet, /state="frozen"/);
  assert.match(sheet, /<autoFilter ref="A1:B3"\/>/);
});

/** Read a ZIP's entries back (local headers only; enough for our own output). */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    const crc = view.getUint32(at + 14, true);
    const csize = view.getUint32(at + 18, true);
    const usize = view.getUint32(at + 22, true);
    const nameLen = view.getUint16(at + 26, true);
    const name = dec.decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const body = bytes.subarray(at + 30 + nameLen, at + 30 + nameLen + csize);
    const data = method === 8 ? new Uint8Array(inflateRawSync(body)) : body;
    assert.equal(data.length, usize, name);
    assert.equal(crc32(data), crc, name);
    out[name] = dec.decode(data);
    at += 30 + nameLen + csize;
  }
  // End-of-central-directory record closes the archive.
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 22 + 10, true), Object.keys(out).length);
  return out;
}

test("zip round-trips stored and deflated entries", async () => {
  const files = [
    { name: "a.txt", data: enc.encode("hello") },
    { name: "dir/ǫ.txt", data: enc.encode("x".repeat(1000)) },
  ];
  for (const deflate of [null, (b) => new Uint8Array(deflateRawSync(b))]) {
    const got = unzip(await zip(files, { deflate }));
    assert.deepEqual(got, { "a.txt": "hello", "dir/ǫ.txt": "x".repeat(1000) });
  }
});

test("buildXlsx packages every part", async () => {
  const matrix = [["Shelfmark"], ["AM 1"]];
  const got = unzip(await buildXlsx(matrix, { sheetName: "NordicLaw", deflate: null }));
  assert.deepEqual(Object.keys(got).sort(), Object.keys(xlsxParts(matrix)).sort());
  assert.match(got["xl/workbook.xml"], /<sheet name="NordicLaw"/);
});

test("merged ranges are written after the autofilter", () => {
  assert.equal(rangeRef({ r0: 1, c0: 0, r1: 4, c1: 2 }), "A2:C5");
  const sheet = xlsxParts([["a", "b"], ["x", ""], ["", ""]], "S", [{ r0: 1, c0: 0, r1: 2, c1: 0 }])["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<autoFilter ref="A1:B3"\/><mergeCells count="1"><mergeCell ref="A2:A3"\/><\/mergeCells><\/worksheet>/);
  assert.doesNotMatch(xlsxParts([["a"]])["xl/worksheets/sheet1.xml"], /mergeCells/);
});

// --- Grouped layout -----------------------------------------------------------

const COLS = ["Shelf mark", "Language", "Production Unit", "Main text", "Links to Database"];
const raw = (i, o) => ({ __sourceRowIndex: i, "Shelf mark": "", Language: "Danish", "Production Unit": "", "Main text": "", "Links to Database": "", ...o });
// One manuscript, three sheet rows; Shelf mark merged over all three, Production
// Unit over rows 0-1; links on two rows.
const MS_ROWS = [
  raw(10, { "Shelf mark": "AM 1", "Production Unit": "I", "Main text": "K", "Links to Database": "[A](https://a)" }),
  raw(11, { "Main text": "KF" }),
  raw(12, { "Production Unit": "II", "Main text": "MEL", "Links to Database": "B" }),
];
const MERGES_JSON = {
  merges: [
    { minRow: 10, maxRow: 12, minCol: "Shelf mark", maxCol: "Shelf mark" },
    { minRow: 10, maxRow: 11, minCol: "Production Unit", maxCol: "Production Unit" },
  ],
};
const MS = { key: "AM||am 1", sourceId: "dan", rows: [] };
const opts = (mergesJson = MERGES_JSON, columns = COLS) => ({
  columns,
  columnsFull: COLS,
  rawByKey: new Map([[MS.key, { rows: MS_ROWS, sourceId: "dan" }]]),
  mergesBySource: new Map(mergesJson ? [["dan", mergesJson]] : []),
});

test("groupedSheet (Manuscript View): sheet merges, Language and aggregated links span the manuscript", () => {
  const { matrix, merges } = groupedSheet([MS], "merged", opts());
  assert.deepEqual(matrix, [
    ["Shelfmark", "Language", "Production Unit", "Main text", "Links to Database"],
    ["AM 1", "Danish", "I", "K", "[A](https://a); B"],
    ["", "", "", "KF", ""],
    ["", "", "II", "MEL", ""],
  ]);
  const refs = merges.map(rangeRef).sort();
  assert.deepEqual(refs, ["A2:A4", "B2:B4", "C2:C3", "E2:E4"]);
});

test("groupedSheet (Production Unit View): merges are cut at unit edges, values repeated per block", () => {
  const units = [
    { ms: MS, run: { start: 0, end: 1 } },
    { ms: MS, run: { start: 2, end: 2 } },
  ];
  const { matrix, merges } = groupedSheet(units, "units", opts());
  assert.deepEqual(matrix.slice(1), [
    ["AM 1", "Danish", "I", "K", "[A](https://a); B"],
    ["", "", "", "KF", ""],
    ["AM 1", "Danish", "II", "MEL", "[A](https://a); B"],
  ]);
  assert.deepEqual(merges.map(rangeRef).sort(), ["A2:A3", "B2:B3", "C2:C3", "E2:E3"]);
});

test("groupedSheet without merge data merges constant values and Production Unit runs", () => {
  const { matrix, merges } = groupedSheet([MS], "merged", opts(null));
  // Production Unit is blank on row 1, so run I covers rows 0-1 (as in the view).
  assert.deepEqual(merges.map(rangeRef).sort(), ["B2:B4", "C2:C3", "E2:E4"]);
  assert.equal(matrix[1][2], "I");
  assert.equal(matrix[3][2], "II");
});

test("groupedSheet never emits overlapping merges", () => {
  // A sheet merge across Shelf mark..Production Unit would cover Language, which
  // already spans the manuscript; it is dropped rather than overlapped.
  const overlapping = { merges: [{ minRow: 10, maxRow: 11, minCol: "Shelf mark", maxCol: "Production Unit" }] };
  const { merges } = groupedSheet([MS], "merged", opts(overlapping));
  const cells = new Set();
  for (const m of merges) {
    for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) {
      assert.ok(!cells.has(`${r},${c}`), `overlap at ${r},${c}`);
      cells.add(`${r},${c}`);
    }
  }
  assert.ok(!merges.some((m) => m.c0 === 0 && m.c1 === 2));
});
