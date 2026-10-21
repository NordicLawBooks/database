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

test("Réttarbót codes resolve from texts.tsv in Minor text, ignoring case, by their leading word", () => {
  const maps = {
    abbr: {},
    main: { RBHM: "Réttarbót Hákon Magnússon", RB: "Réttarbót", Kab: "Kristinréttr Árna biskups" },
    minor: {},
  };
  assert.equal(expandMinorText("RBHM 1305", [], maps), "RBHM – Réttarbót Hákon Magnússon 1305");
  assert.equal(expandMinorText("RbHM (undated)", [], maps), "RbHM – Réttarbót Hákon Magnússon (undated)");
  assert.equal(expandMinorText("Rb; RBHM", [], maps), "Rb – Réttarbót; RBHM – Réttarbót Hákon Magnússon");
  // Other main-text codes still never resolve from Minor text.
  assert.equal(expandMinorText("Kab ch. 16", [], maps), "Kab ch. 16");
  // Joined codes and unknown RB codes are left alone.
  assert.equal(expandMinorText("RBEM&HM 14.5.1290", [], maps), "RBEM&HM 14.5.1290");
  assert.equal(expandMinorText("RBHK 1300", [], maps), "RBHK 1300");
});

test("Réttarbót codes in Main text also ignore case", () => {
  const maps = { abbr: {}, main: { RB: "Réttarbót" }, minor: {} };
  assert.equal(expandMainText("Rb", maps), "Rb – Réttarbót");
  assert.equal(expandMainText("RB", maps), "RB – Réttarbót");
});
