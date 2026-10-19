import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../js/model/manuscript.js";
import {
  manuscriptMatchesFacets,
  rowMatchesFacets,
  computeCounts,
  rangeExtent,
} from "../js/facets/engine.js";
import { FACET_DEFS } from "../js/config.js";
import { makeInitialState } from "../js/store.js";
import { isFacetUnfiltered, clearFacetSelection, matchesOptionSearch, groupSearchVisibility } from "../js/facets/render.js";

// MS "AM||1": r1 Gothic/Code(E)/Prayer;Charm/1300/20, r2 Caroline/Code(W)/Note/1350/variable
// MS "AM||2": r3 Gothic/Other/-/1450/25
function model() {
  return buildModel([
    { Depository: "AM", "Shelf mark": "1", Language: "is", Script: "Gothic", "Main text": "Code (E)", "Minor text": "Prayer; Charm", Dating: "1300", Lines: "20", "Production Unit": "I" },
    { Depository: "AM", "Shelf mark": "1", Language: "is", Script: "Caroline", "Main text": "Code (W)", "Minor text": "Note", Dating: "1350", Lines: "variable", "Production Unit": "II" },
    { Depository: "AM", "Shelf mark": "2", Language: "is", Script: "Gothic", "Main text": "Other", "Minor text": "", Dating: "1450", Lines: "25", "Production Unit": "" },
  ]);
}

function stateWith(patch) {
  const s = makeInitialState();
  Object.assign(s.facets, patch.facets || {});
  Object.assign(s.ranges, patch.ranges || {});
  return s;
}

const ctxFor = (m) => ({ puByKey: m.puByKey });

test("term facet: merged matches whole manuscript if any row matches; row matches per-row", () => {
  const m = model();
  const s = stateWith({ facets: { Script: ["Gothic"] } });
  const [ms1, ms2] = m.manuscripts;

  // Merged: MS1 matches via r1 (even though r2 is Caroline); MS2 via r3.
  assert.equal(manuscriptMatchesFacets(ms1, s, FACET_DEFS), true);
  assert.equal(manuscriptMatchesFacets(ms2, s, FACET_DEFS), true);

  // Row: only the Gothic rows match (this is the deliberate view difference).
  assert.deepEqual(
    m.rows.map((r) => rowMatchesFacets(r, s, FACET_DEFS, ctxFor(m))),
    [true, false, true]
  );
});

test("manuscript-scoped Production units facet", () => {
  const m = model();
  const s = stateWith({ facets: { "Production units": ["2"] } });
  assert.equal(manuscriptMatchesFacets(m.manuscripts[0], s, FACET_DEFS), true); // puValue "2"
  assert.equal(manuscriptMatchesFacets(m.manuscripts[1], s, FACET_DEFS), false); // "Empty"
  // Row scope resolves the same value via puByKey.
  assert.equal(rowMatchesFacets(m.rows[0], s, FACET_DEFS, ctxFor(m)), true);
  assert.equal(rowMatchesFacets(m.rows[2], s, FACET_DEFS, ctxFor(m)), false);
});

test("hierarchical Main text group: variant key and group fallback", () => {
  const m = model();
  const byVariant = stateWith({ facets: { "Main text group-variant": ["Code|E"] } });
  assert.equal(manuscriptMatchesFacets(m.manuscripts[0], byVariant, FACET_DEFS), true);
  assert.equal(rowMatchesFacets(m.rows[1], byVariant, FACET_DEFS, ctxFor(m)), false); // r2 is Code|W

  const byGroup = stateWith({ facets: { "Main text group": ["Code"] } });
  assert.equal(manuscriptMatchesFacets(m.manuscripts[0], byGroup, FACET_DEFS), true);
  assert.equal(manuscriptMatchesFacets(m.manuscripts[1], byGroup, FACET_DEFS), false); // "Other"
});

test("Dating range uses overlap; Lines range uses containment", () => {
  const m = model();
  const dating = stateWith({ ranges: { Dating: { min: 1320, max: 1500 } } });
  // r1 (1300) excluded, r2 (1350) & r3 (1450) included.
  assert.deepEqual(
    m.rows.map((r) => rowMatchesFacets(r, dating, FACET_DEFS, ctxFor(m))),
    [false, true, true]
  );
  assert.equal(manuscriptMatchesFacets(m.manuscripts[0], dating, FACET_DEFS), true); // via r2

  const lines = stateWith({ ranges: { Lines: { min: 20, max: 22 } } });
  // r1 (20) in range, r2 (variable -> unparseable) out, r3 (25) out.
  assert.deepEqual(
    m.rows.map((r) => rowMatchesFacets(r, lines, FACET_DEFS, ctxFor(m))),
    [true, false, false]
  );
});

test("range+terms Lines: text values match independently of the numeric range", () => {
  const m = model();
  const s = stateWith({ facets: { Lines: ["variable"] } });
  assert.deepEqual(
    m.rows.map((r) => rowMatchesFacets(r, s, FACET_DEFS, ctxFor(m))),
    [false, true, false]
  );
});

test("multi Minor text matches any token", () => {
  const m = model();
  const s = stateWith({ facets: { "Minor text": ["Prayer"] } });
  assert.equal(rowMatchesFacets(m.rows[0], s, FACET_DEFS, ctxFor(m)), true);
  assert.equal(rowMatchesFacets(m.rows[1], s, FACET_DEFS, ctxFor(m)), false);
});

test("computeCounts (merged): per-manuscript, de-duped within a manuscript", () => {
  const m = model();
  const s = makeInitialState();
  const counts = computeCounts(m.manuscripts, s, FACET_DEFS, { scope: "manuscript", puByKey: m.puByKey });
  // Gothic in MS1 (r1) and MS2 (r3) -> 2; Caroline only MS1 -> 1.
  assert.equal(counts.Script.counts.get("Gothic"), 2);
  assert.equal(counts.Script.counts.get("Caroline"), 1);
  assert.equal(counts.Script.baseTotal, 2);
  assert.equal(counts["Production units"].counts.get("2"), 1);
  assert.equal(counts["Production units"].counts.get("Empty"), 1);
});

test("computeCounts: a facet's own selection does NOT shrink its sibling option counts", () => {
  const m = model();
  const s = stateWith({ facets: { Script: ["Caroline"] } });
  const counts = computeCounts(m.manuscripts, s, FACET_DEFS, { scope: "manuscript", puByKey: m.puByKey });
  // Excluding its own selection, Script is counted over ALL manuscripts:
  // Gothic still 2 (not narrowed to the Caroline manuscript).
  assert.equal(counts.Script.counts.get("Gothic"), 2);
});

test("computeCounts: a different facet IS narrowed by an active selection", () => {
  const m = model();
  const s = stateWith({ facets: { Script: ["Caroline"] } });
  const counts = computeCounts(m.manuscripts, s, FACET_DEFS, { scope: "manuscript", puByKey: m.puByKey });
  // Only MS1 has Caroline, so Language is counted over MS1 alone.
  assert.equal(counts.Language.counts.get("Icelandic"), 1);
});

test("computeCounts (row scope): Production units counts unique manuscripts", () => {
  const m = model();
  const s = makeInitialState();
  const counts = computeCounts(m.rows, s, FACET_DEFS, { scope: "row", puByKey: m.puByKey });
  // Row scope: Gothic appears in r1 and r3 -> 2 rows.
  assert.equal(counts.Script.counts.get("Gothic"), 2);
  // PU still bucketed per unique manuscript: "2" (MS1) once.
  assert.equal(counts["Production units"].counts.get("2"), 1);
});


test("All box: unfiltered iff the facet (and a hierarchical facet's children) has no selection", () => {
  const facets = { Script: [], "Main text group": [], "Main text group-variant": ["Code|E"] };
  assert.equal(isFacetUnfiltered(facets, "Script"), true);
  assert.equal(isFacetUnfiltered({ Script: ["Gothic"] }, "Script"), false);
  assert.equal(isFacetUnfiltered(facets, "Main text group"), false); // a variant is selected
});

test("clearFacetSelection clears only that facet (both keys for hierarchical)", () => {
  const facets = { Script: ["Gothic"], "Main text group": ["Code"], "Main text group-variant": ["Code|E"] };
  assert.deepEqual(clearFacetSelection(facets, "Main text group"), {
    Script: ["Gothic"], "Main text group": [], "Main text group-variant": [],
  });
  assert.deepEqual(clearFacetSelection(facets, "Script").Script, []);
  assert.deepEqual(facets.Script, ["Gothic"]); // not mutated
});

test("matchesOptionSearch: folded substring, empty query matches all", () => {
  assert.equal(matchesOptionSearch("Þingfararbálkr", "thingfarar"), true);
  assert.equal(matchesOptionSearch("Kristinn réttr", "RETT"), true);
  assert.equal(matchesOptionSearch("Kristinn réttr", "bergen"), false);
  assert.equal(matchesOptionSearch("anything", "  "), true);
});

test("rangeExtent: Dating spans min/max years; Lines parses ranges; unknown -> null", () => {
  const dating = FACET_DEFS.find((d) => d.field === "Dating");
  const lines = FACET_DEFS.find((d) => d.field === "Lines");
  const rows = [
    { DatingMinYear: 1300, DatingMaxYear: 1350, Lines: "20-25" },
    { DatingMinYear: 1250, DatingMaxYear: 1499, Lines: "ca. 31" },
    { Lines: "varies" },
  ];
  assert.deepEqual(rangeExtent(rows, dating), { min: 1250, max: 1499 });
  assert.deepEqual(rangeExtent(rows, lines), { min: 20, max: 31 });
  assert.deepEqual(rangeExtent([], dating), { min: null, max: null });
});

test("groupSearchVisibility: group hit shows all variants; variant hit shows its group", () => {
  const g = { label: "GuL – Gulatingsloven", checked: false };
  const vars = [{ label: "BGO – Bergen", checked: false }, { label: "Other", checked: false }];
  assert.deepEqual(groupSearchVisibility(g, vars, "gula"), { group: true, variants: [true, true] });
  assert.deepEqual(groupSearchVisibility(g, vars, "bergen"), { group: true, variants: [true, false] });
  assert.deepEqual(groupSearchVisibility(g, vars, "zzz"), { group: false, variants: [false, false] });
  // A checked variant stays visible (with its group) even when nothing matches.
  const checkedVar = [{ label: "Other", checked: true }];
  assert.deepEqual(groupSearchVisibility(g, checkedVar, "zzz"), { group: true, variants: [true] });
  assert.deepEqual(groupSearchVisibility(g, vars, ""), { group: true, variants: [true, true] });
});
