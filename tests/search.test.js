import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchIndex, makeIndexQuery } from "../js/search/index.js";
import { sortAfterQueryChange } from "../js/render/controls.js";

const rows = [
  { "Shelf mark": "AM 1", Name: "Bergen codex", Depository: "AM", Literature: "" },
  { "Shelf mark": "AM 2", Name: "Other", Depository: "AM", Literature: "mentions Bergen" },
  { "Shelf mark": "AM 3", Name: "Unrelated", Depository: "AM", Literature: "" },
];

test("makeIndexQuery: null for empty query; matches + scores, Name outranks other text", () => {
  const index = buildSearchIndex(rows);
  assert.equal(makeIndexQuery(index, "  "), null);
  const q = makeIndexQuery(index, "bergen");
  assert.deepEqual(rows.map(q.matches), [true, true, false]);
  assert.ok(q.score(rows[0]) > q.score(rows[1]));
  assert.equal(q.score(rows[2]), 0);
});

test("sortAfterQueryChange: auto-switches default <-> relevance, keeps explicit choices", () => {
  assert.equal(sortAfterQueryChange("", "bergen", "shelfmark"), "relevance");
  assert.equal(sortAfterQueryChange("", "bergen", "dating"), "dating");
  assert.equal(sortAfterQueryChange("berg", "bergen", "shelfmark"), "shelfmark"); // user picked it mid-search
  assert.equal(sortAfterQueryChange("bergen", "", "relevance"), "shelfmark");
  assert.equal(sortAfterQueryChange("bergen", "", "dating"), "dating");
});
