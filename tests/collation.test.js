import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCollation, collationForManuscript, romanToInt } from "../js/model/collation.js";
import { quireSvg, quireSummary } from "../js/render/collation-svg.js";
import { buildCollationHtml } from "../js/render/collation-modal.js";
import { renderCell } from "../js/render/manuscript-view.js";

const folios = (q) => q.leaves.map((l) => l.folio);
const conjoins = (q) => q.leaves.map((l) => l.conjoin);

test("romanToInt", () => {
  assert.equal(romanToInt("XIV"), 14);
  assert.equal(romanToInt("IIII"), 4);
  assert.equal(romanToInt("abc"), null);
});

test("Roman quire list: counts, composition and folios", () => {
  const c = parseCollation("I:8 (4b, ff. 1-8); II:9 (4b, 1f, ff. 9-17)");
  assert.equal(c.quires.length, 2);
  const [q1, q2] = c.quires;
  assert.deepEqual(folios(q1), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.deepEqual(conjoins(q1), [7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal(q2.count, 9);
  assert.deepEqual(conjoins(q2), [8, 7, 6, 5, null, 3, 2, 1, 0]);
  assert.deepEqual(c.warnings, []);
});

test("composition is honoured: 3b + 2f puts the single leaves in the centre", () => {
  const [q] = parseCollation("IV: 8 (3b, 2f, ff. 25-32)").quires;
  assert.equal(q.bifolia, 3);
  assert.equal(q.singles, 2);
  assert.deepEqual(conjoins(q), [7, 6, 5, null, null, 2, 1, 0]);
});

test("Norwegian '3 b; 1 f' and Swedish '1b+3f'", () => {
  const [n] = parseCollation("II: 7 (3 b; 1 f; ff. 1–7)").quires;
  assert.equal(n.bifolia, 3);
  assert.equal(n.singles, 1);
  assert.deepEqual(folios(n), ["1", "2", "3", "4", "5", "6", "7"]);
  const [s] = parseCollation("I:5 (1b+3f; ff. 1-5)").quires;
  assert.equal(s.bifolia, 1);
  assert.equal(s.singles, 3);
});

test("Swedish quire 0, prefixed folio labels and a wrapping parenthesis", () => {
  const c = parseCollation("(0:1 (1f; mirror); I:5 (2b; 1f; ff. 0:1-0:5); II:12 (6b; ff. 1-12))");
  assert.deepEqual(c.quires.map((q) => q.label), ["0", "I", "II"]);
  assert.equal(c.quires[0].note, "mirror");
  assert.deepEqual(folios(c.quires[1]), ["0:1", "0:2", "0:3", "0:4", "0:5"]);
  assert.deepEqual(c.warnings, []);
});

test("non-sequential labels mark first and last leaf only", () => {
  const [q] = parseCollation("I:2 (1b; ff. mirror-endpaper)").quires;
  assert.deepEqual(folios(q), ["mirror", "endpaper"]);
  const [r] = parseCollation("I:2 (1b; ff. I-II)").quires;
  assert.deepEqual(folios(r), ["I", "II"]);
});

test("Icelandic prose prefix becomes a note", () => {
  const c = parseCollation("Before first gathering: f. 1*, a parchment leaf; I: 8 (4b, ff. 1-8)");
  assert.equal(c.quires.length, 1);
  assert.deepEqual(c.notes, ["Before first gathering: f. 1*, a parchment leaf"]);
});

test("bracketed comments are notes, not composition", () => {
  const [q] = parseCollation("III:6 (3b, ff. 18-23 [4b, ff. 1-8 from 9-16])").quires;
  assert.equal(q.bifolia, 3);
  assert.match(q.note, /from 9-16/);
});

test("an unclosed parenthesis does not swallow the next quire", () => {
  const c = parseCollation("XIX:8 (4b, ff. 151-158; XX:8 (4b, ff. 159-166)");
  assert.deepEqual(c.quires.map((q) => q.label), ["XIX", "XX"]);
});

test("mismatches are reported", () => {
  const c = parseCollation("I:9 (4b, ff. 1-8)");
  assert.equal(c.quires[0].count, 9);
  assert.equal(c.warnings.length, 2);
});

test("unreadable formulas give null", () => {
  for (const t of ["", "Unknown", "Unknown (4 gatherings)", "1–10 (ff. 1–71)", "1 bifolium"]) {
    assert.equal(parseCollation(t), null, t);
  }
});

test("collationForManuscript joins the Gatherings segments", () => {
  const ms = { segmentsByColumn: { Gatherings: [{ label: "I:5 (1b+3f; ff. 1-5)" }, { label: "II:4 (2b; ff. 6-9)" }, { label: "" }] } };
  const c = collationForManuscript(ms);
  assert.deepEqual(c.quires.map((q) => q.label), ["I", "II"]);
  assert.equal(collationForManuscript({ segmentsByColumn: { Gatherings: [{ label: "Unknown" }] } }), null);
  assert.equal(collationForManuscript({}), null);
});

test("quireSvg draws one fold per bifolium and one hook per single leaf", () => {
  const [q] = parseCollation("III:9 (4b, 1f, ff. 17-25)").quires;
  const svg = quireSvg(q);
  assert.equal((svg.match(/class="cd-leaf"/g) || []).length, 4);
  assert.equal((svg.match(/class="cd-single"/g) || []).length, 1);
  assert.equal((svg.match(/class="cd-folio"/g) || []).length, 9);
  assert.match(svg, /<title>Quire III: 9 leaves \(4 bifolia, 1 single\), ff\. 17-25<\/title>/);
  assert.equal(quireSummary(q), "Quire III: 9 leaves (4 bifolia, 1 single), ff. 17-25");
});

test("buildCollationHtml escapes notes and lists warnings", () => {
  const html = buildCollationHtml(parseCollation("<b>x</b>: I:9 (4b, ff. 1-8)"));
  assert.ok(!html.includes("<b>x</b>"));
  assert.match(html, /Parser notes \(2\)/);
  assert.match(html, /class="cd-quire"/);
});

test("Gatherings cells get a diagram button only for a readable formula", () => {
  const ctx = { msKey: "A||1", sourceId: "swe" };
  const yes = renderCell("Gatherings", "I:8 (4b, ff. 1-8)", ctx);
  assert.match(yes, /class="cd-formula">I:8 \(4b, ff\. 1-8\)<\/span>/);
  assert.match(yes, /collation-open/);
  assert.doesNotMatch(renderCell("Gatherings", "Unknown", ctx), /collation-open/);
  assert.doesNotMatch(renderCell("Script", "I:8 (4b, ff. 1-8)", ctx), /collation-open/);
});
