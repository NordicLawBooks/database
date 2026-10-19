import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDatingRange,
  parseDatingYear,
  parseCentury,
  parseLinesRange,
  normalizeLinesFacetValue,
  parseMinorTextTokens,
  parseProductionUnitsCell,
  normalizeColumnsFacetValue,
  normalizeLeavesPages,
  normalizeGatherings,
  normalizeScribe,
  normalizeRowLanguage,
  getFacetValue,
} from "../js/model/fields.js";

// --- Dating -----------------------------------------------------------------

test("parseDatingRange: ranges, embedded years, and the doc example", () => {
  assert.deepEqual(parseDatingRange("1363 (ff. 18-23 1500-1525)"), { min: 1363, max: 1525 });
  assert.deepEqual(parseDatingRange("1300–1350"), { min: 1300, max: 1350 }); // en dash
  assert.deepEqual(parseDatingRange("1450"), { min: 1450, max: 1450 });
});

test("parseDatingRange: ordinal centuries use the conventional span", () => {
  assert.deepEqual(parseDatingRange("12th century"), { min: 1101, max: 1200 });
  assert.deepEqual(parseDatingRange("14th century"), { min: 1301, max: 1400 });
  assert.deepEqual(parseDatingRange("9th cent."), { min: 801, max: 900 });
});

test("ordinal century round-trips through parseCentury", () => {
  assert.equal(parseCentury("12th century"), "12th");
  assert.equal(parseCentury("14th century"), "14th");
});

test("parseDatingRange: '1200s' yields only the literal year (century regex needs ddd00s, not ddoos)", () => {
  // Documents legacy behavior: the (\d{3})00s pattern does not match a 5-char
  // "1200s", so just the 4-digit year is captured.
  assert.deepEqual(parseDatingRange("1200s"), { min: 1200, max: 1200 });
});

test("parseDatingRange: excludes reference years outside 500–1800; null when nothing parses", () => {
  assert.equal(parseDatingRange("1885"), null);
  assert.equal(parseDatingRange("see Olsen 1988"), null);
  assert.equal(parseDatingRange(""), null);
  assert.equal(parseDatingRange(null), null);
});

test("parseDatingYear and parseCentury derive from the range min", () => {
  assert.equal(parseDatingYear("1363 (1500-1525)"), 1363);
  assert.equal(parseDatingYear("nope"), null);
  assert.equal(parseCentury("1363"), "14th");
  assert.equal(parseCentury("1200s"), "12th"); // floor((1200-1)/100)+1
  assert.equal(parseCentury("nope"), "");
});

// --- Lines ------------------------------------------------------------------

test("parseLinesRange: ranges, single values, ca. prefix, parenthetical comments", () => {
  assert.deepEqual(parseLinesRange("20-25"), { min: 20, max: 25 });
  assert.deepEqual(parseLinesRange("25 – 20"), { min: 20, max: 25 }); // normalized order
  assert.deepEqual(parseLinesRange("ca. 30"), { min: 30, max: 30 });
  assert.deepEqual(parseLinesRange("1 (f. 8r)"), { min: 1, max: 1 });
  assert.equal(parseLinesRange("variable"), null);
  assert.equal(parseLinesRange(null), null);
});

test("normalizeLinesFacetValue collapses to canonical text", () => {
  assert.equal(normalizeLinesFacetValue("20-20"), "20");
  assert.equal(normalizeLinesFacetValue("20-25"), "20-25");
  assert.equal(normalizeLinesFacetValue("variable"), "variable");
});

// --- Multi-valued cells -----------------------------------------------------

test("parseMinorTextTokens splits on ; and newlines, de-dupes, drops placeholders", () => {
  assert.deepEqual(parseMinorTextTokens("A; B\nC; A"), ["A", "B", "C"]);
  assert.deepEqual(parseMinorTextTokens("."), []);
  assert.deepEqual(parseMinorTextTokens(""), []);
});

test("parseProductionUnitsCell extracts distinct roman numerals, uppercased", () => {
  assert.deepEqual(parseProductionUnitsCell("f. 3r-9v IV; I"), ["IV", "I"]);
  // Token extraction + de-dup (same-case duplicate collapses).
  assert.deepEqual(parseProductionUnitsCell("II; f. 1r II"), ["II"]);
  // Legacy quirk: de-dup key is case-sensitive, so "ii" and "II" do NOT merge.
  assert.deepEqual(parseProductionUnitsCell("ii; II"), ["II", "II"]);
  assert.deepEqual(parseProductionUnitsCell(""), []);
});

// --- Normalizers ------------------------------------------------------------

test("normalizeColumnsFacetValue strips parenthetical comments", () => {
  assert.equal(normalizeColumnsFacetValue("1 (f. 8r)"), "1");
  assert.equal(normalizeColumnsFacetValue("2"), "2");
});

test("normalizeLeavesPages lowercases f/p prefixes and spaces them", () => {
  assert.equal(normalizeLeavesPages("Ff.1r"), "ff. 1r");
  assert.equal(normalizeLeavesPages("P.12"), "p. 12");
  assert.equal(normalizeLeavesPages("pp. 3"), "pp. 3");
});

test("normalizeGatherings collapses whitespace and re-segments blocks", () => {
  assert.equal(normalizeGatherings("(a-b)   II: foo"), "(a-b); II: foo");
});

test("normalizeScribe joins repeated hand markers with '; '", () => {
  assert.equal(normalizeScribe("Hand A foo Hand B bar"), "Hand A foo; Hand B bar");
  assert.equal(normalizeScribe("single scribe"), "single scribe");
});

test("normalizeRowLanguage expands ISO codes in place", () => {
  const row = { Language: "is" };
  normalizeRowLanguage(row);
  assert.equal(row.Language, "Icelandic");
  assert.equal(normalizeRowLanguage({ Language: "" }).Language, "");
});

// --- Facet value ------------------------------------------------------------

test("getFacetValue maps blanks to 'Empty' for empty-label fields, normalizes Columns", () => {
  assert.equal(getFacetValue({ Script: "" }, "Script"), "Empty");
  assert.equal(getFacetValue({ Script: "Gothic" }, "Script"), "Gothic");
  assert.equal(getFacetValue({ Columns: "1 (f. 8r)" }, "Columns"), "1");
  assert.equal(getFacetValue({ Language: "Icelandic" }, "Language"), "Icelandic"); // passthrough
});
