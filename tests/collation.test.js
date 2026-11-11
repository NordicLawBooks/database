import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCollation, collationForManuscript, romanToInt } from "../js/model/collation.js";
import { quireSvg, quireSummary } from "../js/render/collation-svg.js";
import { buildCollationHtml } from "../js/render/collation-modal.js";
import { renderCell } from "../js/render/manuscript-view.js";
import { buildManuscriptModalHtml } from "../js/render/ms-modal.js";

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
  // data-unit: the units whose rows carry this formula (merged cells are blank below)
  const msRows = [
    { "Production Unit": "I", Gatherings: "I:8 (4b, ff. 1-8)" },
    { "Production Unit": "", Gatherings: "" },
    { "Production Unit": "II", Gatherings: "II:8 (4b, ff. 9-16)" },
    { "Production Unit": "III", Gatherings: "" },
  ];
  assert.match(renderCell("Gatherings", "I:8 (4b, ff. 1-8)", { ...ctx, msRows }), /data-unit="I"/);
  assert.match(renderCell("Gatherings", "II:8 (4b, ff. 9-16)", { ...ctx, msRows }), /data-unit="II, III"/);
  assert.match(yes, /data-unit=""/);
  const reversed = [{ "Production Unit": "II", Gatherings: "I:8 (4b)" }, { "Production Unit": "I", Gatherings: "" }];
  assert.match(renderCell("Gatherings", "I:8 (4b)", { ...ctx, msRows: reversed }), /data-unit="I, II"/);
  assert.doesNotMatch(renderCell("Script", "I:8 (4b, ff. 1-8)", ctx), /collation-open/);
});

test("the details modal shows the button only for a readable formula", () => {
  const ctx = { msKey: "A||1", rawByKey: new Map(), depositoryMap: {} };
  const withF = buildManuscriptModalHtml({ segmentsByColumn: { Gatherings: [{ label: "I:8 (4b, ff. 1-8)" }] } }, ctx);
  assert.match(withF, /collation-open/);
  const without = buildManuscriptModalHtml({ segmentsByColumn: { Gatherings: [{ label: "Unknown" }] } }, ctx);
  assert.doesNotMatch(without, /collation-open/);
});

test("collationSvgDocument: standalone SVG with title, quires, notes and formula", async () => {
  const { collationSvgDocument } = await import("../js/render/collation-export.js");
  const c = parseCollation("(0:1 (1f; mirror); I:5 (2b; 1f; ff. 0:1-0:5); II:12 (6b; ff. 1-12))");
  const svg = collationSvgDocument(c, "AM 334 fol. <x>");
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="\d+" height="\d+"/);
  assert.match(svg, /<style>/);
  assert.match(svg, /Collation diagram — AM 334 fol. &lt;x&gt;/);
  assert.equal((svg.match(/class="cd-quire"/g) || []).length, 3);
  assert.match(svg, /class="cd-quire"[^>]* x="\d+(\.\d)?" y="\d+(\.\d)?"/);
  assert.match(svg, />mirror</);
  assert.match(svg, /Formula: \(0:1/);
});

test("collationSvgDocument wraps many quires into rows within the max width", async () => {
  const { collationSvgDocument } = await import("../js/render/collation-export.js");
  const formula = Array.from({ length: 12 }, (_, i) => `${"I".repeat((i % 3) + 1)}:8 (4b)`).join("; ");
  const svg = collationSvgDocument(parseCollation(formula), "");
  const width = Number(/width="(\d+)"/.exec(svg)[1]);
  assert.ok(width <= 960 + 48, `width ${width}`);
  const ys = new Set([...svg.matchAll(/class="cd-quire"[^>]* y="([\d.]+)"/g)].map((m) => m[1]));
  assert.ok(ys.size > 1);
});

test("collationFilename and wrapText", async () => {
  const { collationFilename, wrapText } = await import("../js/render/collation-export.js");
  assert.equal(collationFilename("Den Arnamagnæanske Samling — AM 334 fol. — Unit 2", "svg"),
    "collation-den-arnamagnaeanske-samling-am-334-fol-unit-2.svg");
  assert.equal(collationFilename("", "png"), "collation.png");
  assert.deepEqual(wrapText("aa bb cc dd", 5), ["aa bb", "cc dd"]);
  assert.deepEqual(wrapText("", 5), []);
});

test("collationPages breaks between quires; notes first, formula last", async () => {
  const { collationPages, svgSize } = await import("../js/render/collation-export.js");
  const formula = Array.from({ length: 20 }, (_, i) => `${"I".repeat((i % 3) + 1)}:8 (4b)`).join("; ");
  const c = parseCollation(formula);
  const all = c.quires.length;
  const fits = ({ height }) => height <= 700;
  const pages = collationPages(c, "X", fits);
  assert.ok(pages.length > 1);
  const count = (svg) => (svg.match(/class="cd-quire"/g) || []).length;
  assert.equal(pages.reduce((n, p) => n + count(p), 0), all);
  pages.forEach((p) => assert.ok(fits(svgSize(p)) || count(p) === 1));
  assert.doesNotMatch(pages[0], /\(continued\)/);
  assert.match(pages[1], /Collation diagram — X \(continued\)/);
  assert.match(pages.at(-1), /Formula:/);
  pages.slice(0, -1).forEach((p) => assert.doesNotMatch(p, /Formula:/));
  assert.equal(new Set(pages.map((p) => svgSize(p).width)).size, 1);
  // One page when everything fits
  assert.equal(collationPages(c, "X", () => true).length, 1);
});
