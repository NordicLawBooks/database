import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  setIiifIndex, iiifKeyForUrl, iiifEntryForUrl, manifestsForLinks,
  canvasLabel, folioOf, canvasIdForLocus, leavesTokens, markDigitised,
} from "../js/model/iiif.js";
import { renderLinksHtml, iiifIconsHtml, leavesLinkHtml } from "../js/render/links.js";
import { renderTextTable } from "../js/render/text-table.js";
import { renderCell } from "../js/render/manuscript-view.js";
import { buildManuscriptModalHtml } from "../js/render/ms-modal.js";
import { buildRowDetailsHtml } from "../js/render/row-modal.js";

const MS_MANIFEST = "https://www.manuscripta.se/iiif/100255/manifest.json";
const NB_ID = "9dbcdd9e0b591d6d3e54a7a08796cc5e";
const NB_MANIFEST = `https://api.nb.no/catalog/v1/iiif/${NB_ID}/manifest`;
const INDEX = {
  "ms:100255": { manifest: MS_MANIFEST, canvases: 210 },
  [`nb:${NB_ID}`]: { manifest: NB_MANIFEST, canvases: 263 },
};

afterEach(() => setIiifIndex({}));

test("iiifKeyForUrl: manuscripta (with/without www) and nb.no; non-IIIF sites null", () => {
  assert.equal(iiifKeyForUrl("https://manuscripta.se/ms/100255"), "ms:100255");
  assert.equal(iiifKeyForUrl("https://www.manuscripta.se/ms/100255/"), "ms:100255");
  assert.equal(iiifKeyForUrl(`https://www.nb.no/items/${NB_ID}?page=0`), `nb:${NB_ID}`);
  assert.equal(iiifKeyForUrl("https://sprogsamlinger.ku.dk/q.php?p=ds&s=1"), null);
  assert.equal(iiifKeyForUrl(""), null);
  assert.equal(iiifKeyForUrl(null), null);
});

test("iiifKeyForUrl: NorS folder links", () => {
  assert.equal(iiifKeyForUrl("https://sprogsamlinger.ku.dk/q.php?p=ds/hjem/mapper/7647"), "ns:7647");
  assert.equal(iiifKeyForUrl("http://sprogsamlinger.ku.dk/q.php?p=ds/hjem/mapper/7647"), "ns:7647");
  assert.equal(iiifKeyForUrl("https://sprogsamlinger.ku.dk/q.php?p=ds/hjem/billed/154252"), null); // one image, not a folder
});

test("iiifEntryForUrl: only links in the index", () => {
  setIiifIndex(INDEX);
  assert.deepEqual(iiifEntryForUrl("https://manuscripta.se/ms/100255"), { key: "ms:100255", manifest: MS_MANIFEST, canvases: 210 });
  assert.equal(iiifEntryForUrl("https://manuscripta.se/ms/100256"), null); // not digitised
  setIiifIndex(null);
  assert.equal(iiifEntryForUrl("https://manuscripta.se/ms/100255"), null);
});

test("manifestsForLinks: Markdown and bare links, de-duplicated, in order", () => {
  setIiifIndex(INDEX);
  const value =
    `[NB](https://www.nb.no/items/${NB_ID}?page=0); [MS](https://manuscripta.se/ms/100255); ` +
    "[MS](https://www.manuscripta.se/ms/100255); [HR](https://handrit.is/x); https://manuscripta.se/ms/100256";
  assert.deepEqual(manifestsForLinks(value).map((e) => e.manifest), [NB_MANIFEST, MS_MANIFEST]);
  assert.deepEqual(manifestsForLinks(""), []);
});

test("canvasLabel: Presentation 2 and 3 label shapes", () => {
  assert.equal(canvasLabel({ label: "f. 1r" }), "f. 1r");
  assert.equal(canvasLabel({ label: 7 }), "7");
  assert.equal(canvasLabel({ label: [{ "@value": "f. 2v", "@language": "en" }] }), "f. 2v");
  assert.equal(canvasLabel({ label: { none: ["f. 3r"] } }), "f. 3r");
  assert.equal(canvasLabel({}), "");
});

test("folioOf: folio labels only", () => {
  assert.equal(folioOf("f. 1r"), "1r");
  assert.equal(folioOf("fol. 012 V"), "12v");
  assert.equal(folioOf("12r"), "12r");
  assert.equal(folioOf("left cover, outside"), null);
  assert.equal(folioOf("12"), null); // a bare page/image number isn't a folio
});

const V2 = {
  sequences: [{
    canvases: [
      { "@id": "c0", label: "left cover, outside" },
      { "@id": "c1", label: "f. 1r" },
      { "@id": "c2", label: "f. 1v" },
      { "@id": "c3", label: "f. 2r" },
    ],
  }],
};
const V3 = {
  items: [
    { id: "x1", type: "Canvas", label: { none: ["f. 1r"] } },
    { id: "x2", type: "Canvas", label: { none: ["f. 1v"] } },
  ],
};

test("canvasIdForLocus: matches folio labels; a bare leaf means its recto", () => {
  assert.equal(canvasIdForLocus(V2, { kind: "f", from: "1v" }), "c2");
  assert.equal(canvasIdForLocus(V2, { kind: "f", from: "2" }), "c3");
  assert.equal(canvasIdForLocus(V3, { kind: "f", from: "1V" }), "x2");
  assert.equal(canvasIdForLocus(V2, { kind: "f", from: "99r" }), null);
  assert.equal(canvasIdForLocus(V2, { kind: "p", from: "1" }), null);
  assert.equal(canvasIdForLocus(V2, null), null);
  assert.equal(canvasIdForLocus(null, { kind: "f", from: "1r" }), null);
});

test("iiifIconsHtml: one IIIF icon link per manifest; Links cells stay plain", () => {
  setIiifIndex(INDEX);
  const links = `[MS](https://manuscripta.se/ms/100255); [MS](https://manuscripta.se/ms/100256); [NB](https://www.nb.no/items/${NB_ID})`;
  const html = iiifIconsHtml(links);
  assert.equal((html.match(/class="iiif-open"/g) || []).length, 2);
  assert.ok(html.includes(`href="${MS_MANIFEST}?manifest=${encodeURIComponent(MS_MANIFEST)}"`));
  assert.ok(html.includes(`data-iiif-manifest="${NB_MANIFEST}"`));
  assert.ok(html.includes('<img src="img/iiif.svg"'));
  assert.doesNotMatch(renderLinksHtml(links), /iiif/);
  assert.equal(iiifIconsHtml(""), "");
  setIiifIndex({});
  assert.equal(iiifIconsHtml(links), "");
});

test("grouped views: the IIIF icon follows the Shelfmark link", () => {
  setIiifIndex(INDEX);
  const msRows = [
    { "Shelf mark": "B 3", "Links to Database": "" },
    { "Shelf mark": "", "Links to Database": "[MS](https://manuscripta.se/ms/100255)" },
  ];
  const html = renderCell("Shelf mark", "B 3", { msKey: "KB||B 3", sourceId: "swe", msRows });
  assert.match(html, /class="ms-open-details"[^>]*>B 3<\/a><a href="[^"]+" class="iiif-open"/);
  assert.equal(renderCell("Shelf mark", "B 3", { msKey: "KB||B 3", sourceId: "swe", msRows: [] }).includes("iiif"), false);
});

test("ms modal: View images button and folio loci link into the viewer", () => {
  setIiifIndex(INDEX);
  const ms = {
    Depository: "KB",
    Shelfmark: "B 3",
    segmentsByColumn: {
      "Main text": [{ label: "Code", locus: { kind: "f", from: "5r", to: "9v", rendered: "ff. 5r-9v" } }],
      "Links to Database": [{ label: "[MS](https://manuscripta.se/ms/100255)" }],
    },
  };
  const html = buildManuscriptModalHtml(ms, { msKey: "KB||B 3", rawByKey: new Map(), depositoryMap: {} });
  assert.match(html, /class="btn btn-outline-secondary btn-sm iiif-open-btn"[^>]*>View images</);
  assert.match(html, />ff\. <a [^>]*class="iiif-locus[^"]*"[^>]*data-locus-from="5r"[^>]*>5r<\/a>-<a [^>]*data-locus-from="9v"[^>]*>9v<\/a></);
  assert.match(html, /<td class="text-break">B 3<a href="[^"]+" class="iiif-open"/);

  setIiifIndex({});
  const plain = buildManuscriptModalHtml(ms, { msKey: "KB||B 3", rawByKey: new Map(), depositoryMap: {} });
  assert.doesNotMatch(plain, /iiif-/);
});

test("clampViewerWidth: default 45% of the room, min 320, leaves 480 px for the results", async () => {
  const { clampViewerWidth } = await import("../js/render/iiif-pane.js");
  assert.equal(clampViewerWidth(null, 1100), 495);
  assert.equal(clampViewerWidth(550, 1100), 550);
  assert.equal(clampViewerWidth(100, 1100), 320);
  assert.equal(clampViewerWidth(900, 1100), 620);
  assert.equal(clampViewerWidth(500, 600), 320); // little room: the minimum wins
});

test("row modal: IIIF icon after the shelfmark, Links stay plain", () => {
  setIiifIndex(INDEX);
  const row = { "Shelf mark": "B 3", "Links to Database": "[MS](https://manuscripta.se/ms/100255)" };
  const html = buildRowDetailsHtml(row, ["Shelf mark", "Links to Database"]);
  assert.match(html, />B 3<a href="[^"]+" class="iiif-open" data-iiif-manifest="https:\/\/www\.manuscripta\.se\/iiif\/100255\/manifest\.json"/);
  assert.equal((html.match(/iiif-open/g) || []).length, 1);
});

const tok = (v) => leavesTokens(v).map((t) => (t.folio ? `[${t.text}=${t.folio}]` : t.text)).join("");

test("leavesTokens: every folio in a Leaves/Pages value", () => {
  assert.equal(tok("ff. 1r–17r"), "ff. [1r=1r]–[17r=17r]");
  assert.equal(tok("f.76r"), "f.[76r=76r]");
  assert.equal(tok("Ff. 116v14-117r12"), "Ff. [116v14=116v]-[117r12=117r]");
  assert.equal(tok("f. 151r29-v16"), "f. [151r29=151r]-[v16=151v]"); // a side alone takes the leaf
  assert.equal(tok("F. 89ra–vb"), "F. [89ra=89r]–[vb=89v]");
  assert.equal(tok("f. 151r1-28"), "f. [151r1=151r]-28"); // 28 is a line
  assert.equal(tok("ff. 012-153"), "ff. [012=12]-[153=153]"); // bare leaves (rectos)
  assert.equal(tok("ff.3v:12-5v:3"), "ff.[3v:12=3v]-[5v:3=5v]");
  assert.equal(tok("f.0:7r-v"), "f.0:[7r=7r]-[v=7v]"); // 0: is not a leaf
  assert.equal(tok("Ff. 1v–7v (marg.)"), "Ff. [1v=1v]–[7v=7v] (marg.)");
  assert.equal(tok("f. 1r, f. 9"), "f. [1r=1r], f. [9=9]");
  for (const plain of ["F. *3r", "ff. s. 21–84", "63", "Fragment (between ff.175 and 176)"]) assert.equal(tok(plain), plain);
  assert.deepEqual(leavesTokens(""), []);
});

test("leavesLinkHtml: links to the start folio only with a manifest", () => {
  setIiifIndex(INDEX);
  const links = "[MS](https://manuscripta.se/ms/100255)";
  const html = leavesLinkHtml("ff. 5r–9v", links);
  assert.match(html, /^ff\. <a href="#" class="iiif-locus[^"]*" data-iiif-manifest="https:\/\/www\.manuscripta\.se\/iiif\/100255\/manifest\.json" data-locus-from="5r"[^>]*>5r<\/a>–<a [^>]*data-locus-from="9v"[^>]*>9v<\/a>$/);
  assert.equal(leavesLinkHtml("p. 3 <x>", links), "p. 3 &lt;x&gt;");
  assert.equal(leavesLinkHtml("ff. 5r–9v", "[HR](https://handrit.is/x)"), "ff. 5r–9v");
});

test("Leaves/Pages cells link into the viewer in the grouped and text views", () => {
  setIiifIndex(INDEX);
  const msRows = [
    { "Shelf mark": "B 3", "Leaves/Pages": "ff.5r-9v", "Links to Database": "" },
    { "Shelf mark": "", "Leaves/Pages": "ff.10r-12v", "Links to Database": "[MS](https://manuscripta.se/ms/100255)" },
  ];
  const ctx = { msKey: "KB||B 3", sourceId: "swe", msRows };
  assert.match(renderCell("Leaves/Pages", "ff.5r-9v", ctx), /^ff\. <a [^>]*data-locus-from="5r"[^>]*>5r<\/a>-<a [^>]*data-locus-from="9v"[^>]*>9v<\/a>$/);
  assert.equal(renderCell("Leaves/Pages", "ff.5r-9v", { ...ctx, msRows: [msRows[0]] }), "ff. 5r-9v");

  const host = { innerHTML: "", querySelector: () => null };
  renderTextTable(host, msRows, { page: 1, pageSize: 50 }, ["Shelf mark", "Leaves/Pages"]);
  assert.equal((host.innerHTML.match(/data-locus-from=/g) || []).length, 2);
  assert.match(host.innerHTML, /data-locus-from="10r"[^>]*>10r<\/a>-<a [^>]*data-locus-from="12v"/);
});

test("handrit.is links: keyed by manuscript id; relative manifests resolve against the page", () => {
  for (const url of [
    "https://handrit.is/manuscript/view/is/AM02-0286/0#mode/2up",
    "https://handrit.is/manuscript/view/da/AM02-0286",
    "https://handrit.is/manuscript/view/is/AM02-0286/5#page/1v/mode/2up",
  ]) assert.equal(iiifKeyForUrl(url), "hr:am02-0286");
  assert.equal(iiifKeyForUrl("https://handrit.is/manuscript/view/en/AM08-0056?lang=en"), "hr:am08-0056");

  setIiifIndex({ "hr:am02-0286": { manifest: "data/iiif/handrit/AM02-0286.json", canvases: 56 } });
  const link = "[HR](https://handrit.is/manuscript/view/is/AM02-0286/0#mode/2up)";
  assert.equal(manifestsForLinks(link)[0].manifest, "data/iiif/handrit/AM02-0286.json"); // no document (Node)
  globalThis.document = { baseURI: "https://nordiclawbooks.github.io/database/?q=x" };
  try {
    assert.equal(manifestsForLinks(link)[0].manifest, "https://nordiclawbooks.github.io/database/data/iiif/handrit/AM02-0286.json");
  } finally {
    delete globalThis.document;
  }
});

test("markDigitised: Yes when a link has an indexed manifest, else No", () => {
  setIiifIndex(INDEX);
  const rows = [
    { "Links to Database": "[MS](https://manuscripta.se/ms/100255); [HR](https://handrit.is/x)" },
    { "Links to Database": "[MS](https://manuscripta.se/ms/999999)" },
    { "Links to Database": "" },
    {},
  ];
  markDigitised(rows);
  assert.deepEqual(rows.map((r) => r.Digitised), ["Yes", "No", "No", "No"]);
});
