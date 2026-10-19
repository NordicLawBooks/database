import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getManuscriptKey,
  groupByManuscript,
  buildModel,
  mainTextVariant,
  mainTextGroupVariantKey,
  compareManuscripts,
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
