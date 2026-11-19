import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  setBibliography, literatureTokens, literatureHtml, findEntries, normalizeYear, normalizeAuthor, citeForms,
} from "../js/model/bibliography.js";
import { buildBibliographyHtml } from "../js/render/bib-modal.js";

const ENTRIES = [
  { key: "S1834", creators: ["Schlyter"], year: "1834", html: "Schlyter 1834. <i>Uplandslagen</i>.", text: "Schlyter 1834. Uplandslagen." },
  { key: "S1838", creators: ["Schlyter"], year: "1838", html: "S 1838", text: "Schlyter 1838." },
  { key: "SC1827", creators: ["Schlyter", "Collin"], year: "1827", html: "SC", text: "Schlyter and Collin 1827." },
  { key: "K1868", creators: ["Klemming"], year: "1868-1881", html: "K", text: "Klemming 1868–1881." },
  { key: "KAL", creators: ["Kålund"], year: "1889", html: "K", text: "Kålund 1889." },
  { key: "E1994", creators: ["Eithun", "Rindal", "Ulset"], year: "1994", html: "E", text: "Eithun et al. 1994." },
  { key: "B17a", creators: ["Beckman"], year: "1917", html: "B", text: "Beckman 1917a." },
  { key: "B17b", creators: ["Beckman"], year: "1917", html: "B", text: "Beckman 1917b." },
];

beforeEach(() => setBibliography(ENTRIES));

/** Tokens as "[linked→keys]" + plain text, for compact assertions. */
const show = (v) =>
  literatureTokens(v).map((t) => (t.entries ? `[${t.text}→${t.entries.map((e) => e.key).join(",")}]` : t.text)).join("");

test("normalizeYear expands short ranges and unifies dashes", () => {
  assert.equal(normalizeYear("1868 – 81"), "1868-1881");
  assert.equal(normalizeYear("1868-1881"), "1868-1881");
  assert.equal(normalizeYear("1900"), "1900");
});

test("normalizeAuthor folds case/diacritics, et al. and conjunctions", () => {
  assert.equal(normalizeAuthor("Eithun et.al."), "eithun et al");
  assert.equal(normalizeAuthor("Schlyter & Collin"), "schlyter and collin");
  assert.equal(normalizeAuthor("Schlyter och Collin"), "schlyter and collin");
  assert.equal(normalizeAuthor("Kålund"), "kalund");
  assert.deepEqual(citeForms(["A", "B", "C"]), ["a", "a et al", "a, b and c", "a b and c"]);
});

test("a citation with one year links as a whole, pages included", () => {
  assert.equal(show("Kålund (1889:263-4)"), "[Kålund (1889:263-4)→KAL]");
  assert.equal(show("Kålund 1889, 262-263"), "[Kålund 1889→KAL], 262-263");
  assert.equal(show("Klemming (1868-1881: 63-8)"), "[Klemming (1868-1881: 63-8)→K1868]");
  // Second segment without a year: more pages of the same work.
  assert.equal(show("Schlyter (1834:9; 40-1)"), "[Schlyter (1834:9; 40-1)→S1834]");
});

test("several years in one citation: a link per year", () => {
  assert.equal(
    show("Schlyter (1834:XXI-XXII; 1838: XL; 1999:1)"),
    "Schlyter ([1834:XXI-XXII→S1834]; [1838: XL→S1838]; 1999:1)"
  );
});

test("co-authored works match by first author, all authors, or et al.", () => {
  assert.equal(show("Schlyter (1827:1)"), "[Schlyter (1827:1)→SC1827]");
  assert.equal(show("Schlyter and Collin (1827:1)"), "[Schlyter and Collin (1827:1)→SC1827]");
  assert.equal(show("Eithun et.al (1994:14-15)"), "[Eithun et.al (1994:14-15)→E1994]");
  assert.equal(show("Collin (1827)"), "Collin (1827)"); // second author alone: no
});

test("initials before the last name are ignored; same author+year links to every match", () => {
  assert.deepEqual(findEntries("N. Beckman", "1917").map((e) => e.key), ["B17a", "B17b"]);
  assert.deepEqual(findEntries("Kålund K", "1889").map((e) => e.key), ["KAL"]);
  assert.deepEqual(findEntries("[Kålund", "1889").map((e) => e.key), ["KAL"]);
  assert.deepEqual(findEntries("Kålund", "1889-1890").map((e) => e.key), ["KAL"]);
});

test("tokens round-trip the original text, with separators and unmatched parts", () => {
  for (const v of [
    "Storm (1885:491); Hægstad (1906:9; 40-1)\nKålund (1889:263-4);Tekstnet",
    "Schlyter (1834:XXI; 1838:XL); ",
    "(1834) odd; Kålund 1889",
  ]) {
    assert.equal(literatureTokens(v).map((t) => t.text).join(""), v);
  }
});

test("literatureHtml escapes and links to the entry", () => {
  const html = literatureHtml("Kålund (1889:1) <x>");
  assert.match(html, /^<a href="#bib-KAL" class="bib-cite" data-bib-keys="KAL" title="Kålund 1889\.">Kålund \(1889:1\)<\/a> &lt;x&gt;$/);
  assert.match(literatureHtml("Beckman (1917)"), /data-bib-keys="B17a B17b"/);
});

test("the Zotero Short title is a cite form of its own", () => {
  setBibliography([{ key: "H", creators: ["Ståhle"], year: "1988", short: "Holm (1988)", html: "H", text: "Ståhle 1988." }]);
  assert.equal(show("Holm (1988:12)"), "[Holm (1988:12)→H]");
  assert.equal(show("Ståhle (1988:12)"), "[Ståhle (1988:12)→H]");
});

test("series volumes cited by abbreviation link up to the locator", () => {
  setBibliography([{ key: "V9", creators: ["Schlyter"], year: "1859", cites: ["SSGL 9", "SGL 9"], html: "V9", text: "Skånelagen." }]);
  assert.equal(show("SSGL 9: XX-XXII; SSGL 9: XLVII-XLVIII"), "[SSGL 9: XX-XXII→V9]; [SSGL 9: XLVII-XLVIII→V9]");
  assert.equal(show("SSGL 9: LIII-LIV (nr 31) (the outer leaves)"), "[SSGL 9: LIII-LIV→V9] (nr 31) (the outer leaves)");
  assert.equal(show("SSGL 9 nr 47. ff. 1-70"), "[SSGL 9 nr 47→V9]. ff. 1-70");
  assert.equal(show("SGL 9:XV-XVI"), "[SGL 9:XV-XVI→V9]");
  assert.equal(show("SSGL 8 nr 6"), "SSGL 8 nr 6"); // no such volume
});

test("without a bibliography, citations stay plain", () => {
  setBibliography([]);
  assert.equal(literatureHtml("Kålund (1889:1)"), "Kålund (1889:1)");
});

test("buildBibliographyHtml lists entries with anchors and image links", () => {
  const html = buildBibliographyHtml([
    { key: "A", html: "A <i>T</i>", text: "A T", zotero: "https://z/A", iiif: ["https://m/manifest"] },
  ]);
  assert.match(html, /1 works, from the NordicLaw/);
  assert.match(html, /<li id="bib-A" class="bib-entry" data-bib-key="A"><div>A <i>T<\/i><\/div>/);
  assert.match(html, /data-iiif-manifest="https:\/\/m\/manifest"/);
  assert.match(buildBibliographyHtml([]), /No works yet/);
});
