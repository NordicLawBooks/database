import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMergeAwareFillDown, buildLocalMergeLookup, clipMergeLookup } from "../js/render/merge-geometry.js";

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

test("applyMergeAwareFillDown never overwrites a non-blank cell inside a merge", () => {
  const rs = rows();
  rs[1].B = "own value";
  applyMergeAwareFillDown(rs, merges);
  assert.equal(rs[1].B, "own value");
});

test("applyMergeAwareFillDown treats whitespace-only cells as blank", () => {
  const rs = rows();
  rs[1].B = "  \t ";
  applyMergeAwareFillDown(rs, merges);
  assert.equal(rs[1].B, "X");
});

test("applyMergeAwareFillDown does nothing when the merge's top cell is blank", () => {
  const rs = rows();
  rs[0].B = "";
  rs[1].B = "";
  applyMergeAwareFillDown(rs, merges);
  assert.equal(rs[0].B, "");
  assert.equal(rs[1].B, "");
});

test("applyMergeAwareFillDown fills every column of a multi-column merge (via columns)", () => {
  const rs = [
    { A: "a0", B: "b0", C: "c0", __sourceRowIndex: 0 },
    { A: "", B: "", C: "", __sourceRowIndex: 1 },
  ];
  const wide = { columns: ["A", "B", "C"], merges: [{ minRow: 0, maxRow: 1, minColIndex: 0, maxColIndex: 1 }] };
  applyMergeAwareFillDown(rs, wide);
  assert.deepEqual([rs[1].A, rs[1].B, rs[1].C], ["a0", "b0", ""]); // C is outside the merge
});

test("applyMergeAwareFillDown falls back to minCol when the column list is missing", () => {
  const rs = rows();
  applyMergeAwareFillDown(rs, { merges: [{ minRow: 0, maxRow: 1, minCol: "B" }] });
  assert.equal(rs[1].B, "X");
});

test("applyMergeAwareFillDown matches rows by __sourceRowIndex, not array position", () => {
  const rs = rows().reverse(); // array order no longer matches source order
  applyMergeAwareFillDown(rs, merges);
  assert.equal(rs.find((r) => r.__sourceRowIndex === 1).B, "X");
});

test("applyMergeAwareFillDown only fills the rows it is given (a merge crossing the block edge)", () => {
  // load.js fills one manuscript at a time. A merge reaching past the block fills
  // only the rows present; if the top row is absent, nothing is filled.
  const block = rows().slice(1); // rows 1-2 only; the merge's top (row 0) is missing
  applyMergeAwareFillDown(block, merges);
  assert.equal(block[0].B, "");
  const top = rows().slice(0, 1); // just row 0: nothing below to fill, no error
  applyMergeAwareFillDown(top, merges);
  assert.equal(top[0].B, "X");
});

test("applyMergeAwareFillDown skips malformed merges", () => {
  const rs = rows();
  applyMergeAwareFillDown(rs, { columns: ["A", "B", "C"], merges: [null, { minRow: "0", maxRow: 1, minCol: "B" }, {}] });
  assert.equal(rs[1].B, "");
});

test("buildLocalMergeLookup marks the top-left span and covered cells", () => {
  const cols = ["A", "B", "C"];
  const lookup = buildLocalMergeLookup(rows(), merges, cols, cols);
  assert.deepEqual(lookup.topLeft.get("0,1"), { rowSpan: 2, colSpan: 1, row: 0 });
  assert.ok(lookup.covered.has("1,1")); // the covered cell is skipped during render
  assert.equal(lookup.covered.has("0,1"), false); // top-left is not "covered"
});

test("buildLocalMergeLookup remaps spans onto the visible-column subset", () => {
  // Hide column A: visible grid is [B, C], so B's merge lands at visible col 0.
  const lookup = buildLocalMergeLookup(rows(), merges, ["A", "B", "C"], ["B", "C"]);
  assert.deepEqual(lookup.topLeft.get("0,0"), { rowSpan: 2, colSpan: 1, row: 0 });
  assert.ok(lookup.covered.has("1,0"));
});

test("buildLocalMergeLookup ignores merges not fully contained in the rows", () => {
  const partial = { columns: ["A", "B", "C"], merges: [{ minRow: 1, maxRow: 5, minCol: "B", maxCol: "B" }] };
  const lookup = buildLocalMergeLookup(rows(), partial, ["A", "B", "C"], ["A", "B", "C"]);
  assert.equal(lookup.topLeft.size, 0);
});

test("clipMergeLookup cuts a merge at the range edge, keeping its value row", () => {
  // B spans rows 0-2 and C rows 0-1; clip to rows 1-2 (a run starting mid-merge).
  const tall = {
    columns: ["A", "B", "C"],
    merges: [
      { minRow: 0, maxRow: 2, minCol: "B", maxCol: "B" },
      { minRow: 0, maxRow: 1, minCol: "C", maxCol: "C" },
    ],
  };
  const cols = ["A", "B", "C"];
  const clipped = clipMergeLookup(buildLocalMergeLookup(rows(), tall, cols, cols), 1, 2);
  assert.deepEqual(clipped.topLeft.get("0,1"), { rowSpan: 2, colSpan: 1, row: 0 }); // value from row 0
  assert.ok(clipped.covered.has("1,1"));
  assert.deepEqual(clipped.topLeft.get("0,2"), { rowSpan: 1, colSpan: 1, row: 0 }); // one-row stub
  assert.equal(clipped.covered.has("1,2"), false); // row 2 of C is outside the merge
});

test("clipMergeLookup drops merges outside the range", () => {
  const cols = ["A", "B", "C"];
  const clipped = clipMergeLookup(buildLocalMergeLookup(rows(), merges, cols, cols), 2, 2);
  assert.equal(clipped.topLeft.size, 0);
  assert.equal(clipped.covered.size, 0);
});
