import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../js/model/manuscript.js";
import { selectResults } from "../js/filter/pipeline.js";
import { makeInitialState } from "../js/store.js";

function model() {
  return buildModel([
    { Depository: "AM", "Shelf mark": "1", Language: "is", Script: "Gothic", "Main text": "Code (E)", Dating: "1300" },
    { Depository: "AM", "Shelf mark": "1", Language: "is", Script: "Caroline", "Main text": "Code (W)", Dating: "1350" },
    { Depository: "AM", "Shelf mark": "2", Language: "is", Script: "Gothic", "Main text": "Other", Dating: "1450" },
  ]);
}

function withScript(view, values) {
  const s = makeInitialState();
  s.view = view;
  s.facets.Script = values;
  return s;
}

test("merged view returns whole manuscripts (all their rows) where any row matches", () => {
  const m = model();
  const res = selectResults(m, withScript("merged", ["Gothic"]));
  assert.deepEqual(res.manuscripts.map((ms) => ms.key), ["AM||1", "AM||2"]);
  assert.equal(res.rows.length, 3); // MS1 contributes BOTH its rows
  assert.deepEqual(res.totals, { manuscripts: 2, rows: 3 });
});

test("table view returns only individually-matching rows", () => {
  const m = model();
  const res = selectResults(m, withScript("table", ["Gothic"]));
  assert.equal(res.manuscripts.length, 0);
  assert.equal(res.rows.length, 2); // r2 (Caroline) is excluded
  assert.equal(res.totals.rows, 2);
  assert.equal(res.totals.manuscripts, 2); // distinct manuscripts among matched rows
});

test("no selections returns everything; default sort is by shelfmark", () => {
  const m = model();
  const res = selectResults(m, makeInitialState());
  assert.deepEqual(res.manuscripts.map((ms) => ms.key), ["AM||1", "AM||2"]);
  assert.equal(res.rows.length, 3);
});

test("query (merged): keeps a manuscript when ANY of its rows match", () => {
  const m = model();
  const s = makeInitialState();
  // Matches only r2 (Caroline) of AM||1, plus nothing in AM||2.
  const matchesQuery = (row) => row.Script === "Caroline";
  const res = selectResults(m, s, { matchesQuery });
  assert.deepEqual(res.manuscripts.map((ms) => ms.key), ["AM||1"]);
  assert.equal(res.rows.length, 2); // whole manuscript (both rows) shown in merged view
});

test("query (table): filters to only the individually-matching rows", () => {
  const m = model();
  const s = makeInitialState();
  s.view = "table";
  // Same predicate: in Text View only the matching row appears, not the whole manuscript.
  const matchesQuery = (row) => row.Script === "Caroline";
  const res = selectResults(m, s, { matchesQuery });
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].Script, "Caroline");
});

test("counts ride along with the result for the sidebar", () => {
  const m = model();
  const res = selectResults(m, makeInitialState());
  assert.equal(res.counts.Script.counts.get("Gothic"), 2);
});
