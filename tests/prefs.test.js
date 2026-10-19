import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPrefs, savePrefs, migrateLegacyPrefs, withRememberedViewSort } from "../js/prefs.js";
import { pagerLabel } from "../js/render/controls.js";

const fakeStorage = (entries = {}) => {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};

test("legacy keys migrate once when no new prefs exist", () => {
  const s = fakeStorage({
    "nordiclaw.view": "table",
    "nordiclaw.mergedSort": "dating",
    "nordiclaw.facetsHidden": "1",
    "nordiclaw.tableColumns": JSON.stringify(["Depository", "Shelf mark"]),
  });
  assert.deepEqual(loadPrefs(s), {
    view: "table",
    sort: "dating",
    ui: { facetsHidden: true },
    columns: { table: ["Depository", "Shelf mark"] }, // merged absent -> default preset in main
  });
  assert.equal(migrateLegacyPrefs(fakeStorage()), null);
});

test("new prefs win over legacy keys; invalid view/sort are dropped", () => {
  const s = fakeStorage({
    "nordiclaw.prefs": JSON.stringify({ view: "bogus", sort: "relevance", ui: { facetsHidden: false } }),
    "nordiclaw.view": "table",
  });
  assert.deepEqual(loadPrefs(s), { ui: { facetsHidden: false } });
});

test("savePrefs stores view + sort, with relevance saved as the default sort", () => {
  const s = fakeStorage();
  const state = { columns: { merged: null, table: null }, ui: {}, view: "table", sort: "relevance" };
  savePrefs(state, s);
  assert.deepEqual(JSON.parse(s.map.get("nordiclaw.prefs")), { ...state, sort: "shelfmark" });
  savePrefs({ ...state, sort: "dating" }, s);
  assert.equal(loadPrefs(s).sort, "dating");
});

test("withRememberedViewSort: remembered values fill in only what the URL doesn't name", () => {
  const decoded = { view: "merged", sort: "shelfmark", query: "" };
  const prefs = { view: "table", sort: "dating" };
  assert.deepEqual(withRememberedViewSort(decoded, "", prefs), { view: "table", sort: "dating", query: "" });
  assert.deepEqual(withRememberedViewSort(decoded, "?v=m&sort=shelfmark", prefs), decoded);
  assert.deepEqual(withRememberedViewSort(decoded, "?q=x", {}), decoded);
});

test("pagerLabel matches the legacy wording", () => {
  assert.equal(pagerLabel({ page: 2, totalPages: 5, shown: 20, total: 87 }, "manuscripts"), "Page 2 / 5 — showing 20 of 87 manuscripts");
  assert.equal(pagerLabel({ page: 1, totalPages: 1, shown: 7, total: 7 }, "texts"), "Showing 7 of 7 texts");
  assert.equal(pagerLabel({ page: 1, totalPages: 1, shown: 0, total: 0 }, "texts"), "");
  assert.equal(pagerLabel(null, "texts"), "");
});
