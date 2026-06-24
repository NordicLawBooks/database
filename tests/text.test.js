import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  normalizeForCompare,
  splitSemicolonList,
  toDomIdToken,
  fold,
  compareValues,
} from "../js/util/text.js";

test("escapeHtml escapes the five HTML-sensitive characters", () => {
  assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("normalizeForCompare trims and treats lone '.' as empty", () => {
  assert.equal(normalizeForCompare("  AM 315  "), "AM 315");
  assert.equal(normalizeForCompare("."), "");
  assert.equal(normalizeForCompare(null), "");
  assert.equal(normalizeForCompare(undefined), "");
});

test("splitSemicolonList splits, trims, drops empties", () => {
  assert.deepEqual(splitSemicolonList("a; b ;; c"), ["a", "b", "c"]);
  assert.deepEqual(splitSemicolonList(""), []);
  assert.deepEqual(splitSemicolonList(null), []);
});

test("toDomIdToken keeps id-safe chars, collapses the rest to _", () => {
  assert.equal(toDomIdToken("Main text (X)"), "Main_text_X_");
  assert.equal(toDomIdToken("  a/b c  "), "a_b_c");
  assert.equal(toDomIdToken(null), "");
});

test("fold folds combining diacritics", () => {
  assert.equal(fold("Reykjavík"), "reykjavik");
  assert.equal(fold("Ölkofra"), "olkofra");
  assert.equal(fold("á é í ó ú"), "a e i o u");
});

test("fold folds Nordic letters NFD cannot decompose", () => {
  assert.equal(fold("þingfararbalkr"), "thingfararbalkr");
  assert.equal(fold("Þingvellir"), "thingvellir"); // uppercase Þ
  assert.equal(fold("Guðmundur"), "gudmundur");
  assert.equal(fold("ærlig"), "aerlig");
  assert.equal(fold("København"), "kobenhavn");
  assert.equal(fold("œuvre"), "oeuvre");
  assert.equal(fold("groß"), "gross");
});

test("fold matches across orthographic variants", () => {
  // A user typing the ASCII-ized form folds to the same token as the source.
  assert.equal(fold("thingvellir"), fold("Þingvellir"));
  assert.equal(fold("aerlig"), fold("ærlig"));
  assert.equal(fold(null), "");
});

test("compareValues sorts numerically and case-insensitively", () => {
  assert.ok(compareValues("2", "10") < 0); // numeric, not lexicographic
  assert.equal(compareValues("am", "AM"), 0); // base sensitivity
  assert.deepEqual(["10", "2", "1"].sort(compareValues), ["1", "2", "10"]);
});
