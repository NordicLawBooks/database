import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatAbbrExpansion,
  expandMainText,
  expandMinorText,
  mainCandidatesFrom,
  minorTextKey,
  EN_DASH,
} from "../js/model/expand.js";

const maps = {
  abbr: { BGO: "Bergen", Dipl: "Charter (Diplom)" },
  main: { K: "Kristinréttr", KJE: "Kristinréttr Jóns Erkibiskups" },
  minor: { [minorTextKey("K", "Mh")]: "Mannhelgi", [minorTextKey("KJE", "Mh")]: "Other" },
};

test("formatAbbrExpansion: exact main, exact abbr, and base+suffix", () => {
  assert.equal(formatAbbrExpansion(maps, "K"), `K${EN_DASH}Kristinréttr`);
  assert.equal(formatAbbrExpansion(maps, "BGO"), `BGO${EN_DASH}Bergen`);
  // base "K" + suffix "(BGO)" with the suffix token expanded too:
  assert.equal(formatAbbrExpansion(maps, "K (BGO)"), `K${EN_DASH}Kristinréttr (BGO${EN_DASH}Bergen)`);
  assert.equal(formatAbbrExpansion(maps, "Unknown"), "Unknown"); // unchanged
  assert.equal(formatAbbrExpansion(maps, ""), "");
});

test("expandMainText expands each ;-separated code", () => {
  assert.equal(
    expandMainText("K; KJE", maps),
    `K${EN_DASH}Kristinréttr; KJE${EN_DASH}Kristinréttr Jóns Erkibiskups`
  );
  assert.equal(expandMainText("", maps), "");
});

test("expandMinorText resolves a section against a single main candidate", () => {
  assert.equal(expandMinorText("Mh", ["K"], maps), `Mh${EN_DASH}Mannhelgi`);
});

test("expandMinorText: ambiguous candidates only resolve on a unique hit", () => {
  // Both K and KJE have an "Mh" -> two hits -> not resolved -> plain fallback.
  assert.equal(expandMinorText("Mh", ["K", "KJE"], maps), "Mh");
  // No candidates -> fallback to abbreviation expansion (no match here).
  assert.equal(expandMinorText("Mh", [], maps), "Mh");
});

test("mainCandidatesFrom strips suffixes and de-dupes", () => {
  assert.deepEqual(mainCandidatesFrom("K (BGO); K; KJE"), ["K", "KJE"]);
});

test("expandMinorText fallback uses abbreviations.tsv only, never the main-text map", () => {
  // "K" is a main-text code; an unresolved Minor text "K" must stay raw (legacy parity).
  assert.equal(expandMinorText("K", [], maps), "K");
  assert.equal(expandMinorText("BGO", [], maps), `BGO${EN_DASH}Bergen`);
});
