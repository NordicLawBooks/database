import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRowDetailsHtml } from "../js/render/row-modal.js";
import { visibleColumns } from "../js/render/columns.js";
import { getPreset, COLUMN_PRESETS } from "../js/config.js";
import { makeInitialState } from "../js/store.js";

test("getPreset intersects a preset with available columns (order = allColumns); unknown => null (all)", () => {
  const all = ["Depository", "Shelf mark", "Language", "Dating", "Script"];
  const textual = getPreset("textual", all);
  // Only the textual columns that exist in `all`, in `all` order.
  assert.deepEqual(textual, COLUMN_PRESETS.textual.filter((c) => all.includes(c)));
  assert.ok(textual.includes("Dating") && !textual.includes("Script"));
  assert.equal(getPreset("all", all), null);
  assert.equal(getPreset("nope", all), null);
});

test("buildRowDetailsHtml: two columns, titles, links, hides derived fields", () => {
  const row = {
    "Shelf mark": "AM 1",
    Script: "Gothic",
    "Links to Database": "[handrit](https://handrit.is/x)",
    "Main text group": "Code", // derived/hidden -> excluded
  };
  const html = buildRowDetailsHtml(row, ["Shelf mark", "Script", "Links to Database", "Main text group"]);
  assert.match(html, /col-md-6/);
  assert.match(html, />Shelfmark</); // title override
  assert.match(html, /Gothic/);
  assert.match(html, /<a href="https:\/\/handrit\.is\/x"[^>]*>handrit<\/a>/);
  assert.doesNotMatch(html, /Main text group/); // hidden field excluded
});

test("visibleColumns: null shows all; an explicit list filters and orders by allColumns", () => {
  const all = ["Depository", "Shelf mark", "Script", "Lines"];
  const s = makeInitialState();
  s.view = "table";
  assert.deepEqual(visibleColumns(all, s), all); // default null

  s.columns.table = ["Lines", "Script"]; // out of order -> reordered by `all`
  assert.deepEqual(visibleColumns(all, s), ["Script", "Lines"]);
});

test("visibleColumns: never hides everything (empty selection falls back to all)", () => {
  const all = ["Depository", "Shelf mark"];
  const s = makeInitialState();
  s.view = "merged";
  s.columns.merged = []; // user unchecked all
  assert.deepEqual(visibleColumns(all, s), all);
});

test("visibleColumns is per-view", () => {
  const all = ["A", "B", "C"];
  const s = makeInitialState();
  s.columns.table = ["A"];
  s.columns.merged = ["B", "C"];
  s.view = "table";
  assert.deepEqual(visibleColumns(all, s), ["A"]);
  s.view = "merged";
  assert.deepEqual(visibleColumns(all, s), ["B", "C"]);
});
