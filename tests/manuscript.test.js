import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getManuscriptKey,
  groupByManuscript,
  buildModel,
  mainTextVariant,
  mainTextGroupVariantKey,
  compareManuscripts,
  productionUnitRuns,
  productionUnitLabel,
  productionUnitsWithDating,
  listUnits,
} from "../js/model/manuscript.js";

function rows() {
  return [
    { Depository: "AM", "Shelf mark": "1", "Main text": "Code (E)", "Production Unit": "I", Dating: "1300" },
    { Depository: "AM", "Shelf mark": "1", "Main text": "Code (W)", "Production Unit": "II", Dating: "1350" },
    { Depository: "AM", "Shelf mark": "2", "Main text": "Other", "Production Unit": "", Dating: "1450" },
  ];
}

test("getManuscriptKey prefers Depository_abbr, falls back to Depository", () => {
  assert.equal(getManuscriptKey({ Depository: "AM", "Shelf mark": "1" }), "AM||1");
  assert.equal(getManuscriptKey({ Depository_abbr: "AM", Depository: "Arnamagnæan", "Shelf mark": "1" }), "AM||1");
});

test("groupByManuscript groups consecutive rows, preserving order", () => {
  const groups = groupByManuscript(rows());
  assert.deepEqual(groups.map((g) => g.key), ["AM||1", "AM||2"]);
  assert.equal(groups[0].rows.length, 2);
});

test("mainTextVariant / mainTextGroupVariantKey parse 'Code (Variant)'", () => {
  assert.equal(mainTextVariant({ "Main text": "Code (E)" }), "E");
  assert.equal(mainTextVariant({ "Main text": "Other" }), "");
  assert.equal(mainTextGroupVariantKey({ "Main text group": "Code", "Main text": "Code (E)" }), "Code|E");
});

test("buildModel enriches rows and derives Production units per manuscript", () => {
  const model = buildModel(rows());
  assert.equal(model.manuscripts.length, 2);
  const [ms1, ms2] = model.manuscripts;
  assert.equal(ms1.rows[0]["Main text group"], "Code"); // enriched
  assert.equal(ms1.rows[0]["DatingMinYear"], 1300);
  assert.equal(ms1.puValue, "2"); // two distinct units (I, II)
  assert.equal(ms2.puValue, "Empty"); // none
  assert.equal(model.puByKey.get("AM||1"), "2");
});

test("compareManuscripts: shelfmark default, dating mode by earliest year", () => {
  const model = buildModel(rows());
  const [ms1, ms2] = model.manuscripts;
  assert.ok(compareManuscripts(ms1, ms2, "shelfmark") < 0); // "1" before "2"
  assert.ok(compareManuscripts(ms1, ms2, "dating") < 0); // 1300 before 1450
});

test("productionUnitRuns splits on unit changes; blanks continue the run above", () => {
  const pu = (...vals) => vals.map((v) => ({ "Production Unit": v }));
  assert.deepEqual(productionUnitRuns(pu("I", "", "II", "II", "")), [
    { start: 0, end: 1, raw: "I" },
    { start: 2, end: 4, raw: "II" },
  ]);
  // Leading blanks form their own run; a single row is a single run.
  assert.deepEqual(productionUnitRuns(pu("", "I")), [
    { start: 0, end: 0, raw: "" },
    { start: 1, end: 1, raw: "I" },
  ]);
  assert.deepEqual(productionUnitRuns(pu("III")), [{ start: 0, end: 0, raw: "III" }]);
  assert.deepEqual(productionUnitRuns([]), []);
});

test("productionUnitLabel: roman numerals, Unknown, or Empty", () => {
  assert.equal(productionUnitLabel("I; ii"), "I, II");
  assert.equal(productionUnitLabel(" unknown "), "Unknown");
  assert.equal(productionUnitLabel(""), "Empty");
});

test("productionUnitsWithDating gives each run its earliest year (null if undated)", () => {
  const rs = [
    { "Production Unit": "I", Dating: "1460" },
    { "Production Unit": "", Dating: "1400-1500" },
    { "Production Unit": "II", Dating: "" },
  ];
  assert.deepEqual(productionUnitsWithDating(rs).map((u) => u.minYear), [1400, null]);
});

test("listUnits: dating sorts units on their own year; other sorts keep manuscript order", () => {
  const ms = (key, ...units) => ({
    key,
    rows: units.map(([pu, dating]) => ({ "Production Unit": pu, Dating: dating })),
  });
  // A's unit III is late; B is undated; C's single unit sits between A's units.
  const list = [
    ms("A", ["III", "1500-1600"], ["I", "1200"]),
    ms("B", ["I", ""]),
    ms("C", ["I", "1300"]),
  ];
  const label = (u) => `${u.ms.key}:${u.run.raw}`;
  assert.deepEqual(listUnits(list, null, "shelfmark").map(label), ["A:III", "A:I", "B:I", "C:I"]);
  assert.deepEqual(listUnits(list, null, "dating").map(label), ["A:I", "C:I", "A:III", "B:I"]);
  // Precomputed runs win over the manuscript's own rows.
  const pre = new Map([["B", [{ start: 0, end: 0, raw: "I", minYear: 1100 }]]]);
  assert.equal(label(listUnits(list, pre, "dating")[0]), "B:I");
});
