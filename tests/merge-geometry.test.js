import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMergeAwareFillDown, buildLocalMergeLookup } from "../js/render/merge-geometry.js";

// Columns A,B,C; three rows. Merge region: column B spans rows 0-1 (a rowspan).
function rows() {
  return [
    { A: "a0", B: "X", C: "c0", __sourceRowIndex: 0 },
    { A: "a1", B: "", C: "c1", __sourceRowIndex: 1 },
    { A: "a2", B: "Y", C: "c2", __sourceRowIndex: 2 },
  ];
}

const merges = {
  columns: ["A", "B", "C"],
  merges: [{ minRow: 0, maxRow: 1, minColIndex: 1, maxColIndex: 1, minCol: "B", maxCol: "B" }],
};

test("applyMergeAwareFillDown copies the top value into blank covered cells", () => {
  const rs = rows();
  applyMergeAwareFillDown(rs, merges);
  assert.equal(rs[0].B, "X");
  assert.equal(rs[1].B, "X"); // filled down
  assert.equal(rs[2].B, "Y"); // outside the merge, untouched
});

test("applyMergeAwareFillDown is a no-op without merges", () => {
  const rs = rows();
  applyMergeAwareFillDown(rs, { merges: [] });
  assert.equal(rs[1].B, "");
});

test("buildLocalMergeLookup marks the top-left span and covered cells", () => {
  const cols = ["A", "B", "C"];
  const lookup = buildLocalMergeLookup(rows(), merges, cols, cols);
  assert.deepEqual(lookup.topLeft.get("0,1"), { rowSpan: 2, colSpan: 1 });
  assert.ok(lookup.covered.has("1,1")); // the covered cell is skipped during render
  assert.equal(lookup.covered.has("0,1"), false); // top-left is not "covered"
});

test("buildLocalMergeLookup remaps spans onto the visible-column subset", () => {
  // Hide column A: visible grid is [B, C], so B's merge lands at visible col 0.
  const lookup = buildLocalMergeLookup(rows(), merges, ["A", "B", "C"], ["B", "C"]);
  assert.deepEqual(lookup.topLeft.get("0,0"), { rowSpan: 2, colSpan: 1 });
  assert.ok(lookup.covered.has("1,0"));
});

test("buildLocalMergeLookup ignores merges not fully contained in the rows", () => {
  const partial = { columns: ["A", "B", "C"], merges: [{ minRow: 1, maxRow: 5, minCol: "B", maxCol: "B" }] };
  const lookup = buildLocalMergeLookup(rows(), partial, ["A", "B", "C"], ["A", "B", "C"]);
  assert.equal(lookup.topLeft.size, 0);
});
