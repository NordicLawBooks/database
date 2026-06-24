import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTSV } from "../js/data/tsv.js";

test("parses headers and rows; missing trailing cells default to ''", () => {
  const text = "A\tB\tC\n1\t2\t3\nx\ty";
  const { headers, rows } = parseTSV(text);
  assert.deepEqual(headers, ["A", "B", "C"]);
  assert.deepEqual(rows, [
    { A: "1", B: "2", C: "3" },
    { A: "x", B: "y", C: "" },
  ]);
});

test("default mode drops blank/whitespace-only lines (combined-TSV path)", () => {
  const text = "A\tB\n1\t2\n\n   \n3\t4\n";
  const { rows } = parseTSV(text);
  assert.deepEqual(rows, [
    { A: "1", B: "2" },
    { A: "3", B: "4" },
  ]);
});

test("keepBlankLines preserves interior blank rows (raw-TSV path)", () => {
  // A row of empty cells must survive so its index aligns with merge geometry.
  const text = "A\tB\n1\t2\n\t\n3\t4\n";
  const { rows } = parseTSV(text, { keepBlankLines: true });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], { A: "", B: "" });
  assert.deepEqual(rows[2], { A: "3", B: "4" });
});

test("keepBlankLines still drops only the trailing newline's empty line", () => {
  const text = "A\tB\n1\t2\n";
  const { rows } = parseTSV(text, { keepBlankLines: true });
  assert.equal(rows.length, 1);
});

test("handles CRLF line endings", () => {
  const { headers, rows } = parseTSV("A\tB\r\n1\t2\r\n");
  assert.deepEqual(headers, ["A", "B"]);
  assert.deepEqual(rows, [{ A: "1", B: "2" }]);
});

test("empty / nullish input yields empty headers and rows", () => {
  assert.deepEqual(parseTSV(""), { headers: [], rows: [] });
  assert.deepEqual(parseTSV(null), { headers: [], rows: [] });
  assert.deepEqual(parseTSV("   \n  "), { headers: [], rows: [] });
});
