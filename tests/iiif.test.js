import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  setIiifIndex, iiifKeyForUrl, iiifEntryForUrl, manifestsForLinks,
  canvasLabel, folioOf, canvasIdForLocus,
} from "../js/model/iiif.js";
import { renderLinksHtml, iiifIconsHtml } from "../js/render/links.js";
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

test("iiifKeyForUrl: manuscripta (with/without www) and nb.no; others null", () => {
  assert.equal(iiifKeyForUrl("https://manuscripta.se/ms/100255"), "ms:100255");
  assert.equal(iiifKeyForUrl("https://www.manuscripta.se/ms/100255/"), "ms:100255");
  assert.equal(iiifKeyForUrl(`https://www.nb.no/items/${NB_ID}?page=0`), `nb:${NB_ID}`);
  assert.equal(iiifKeyForUrl("https://handrit.is/manuscript/view/da/AM02-0286/0"), null);
  assert.equal(iiifKeyForUrl(""), null);
  assert.equal(iiifKeyForUrl(null), null);
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
  assert.match(html, /class="iiif-locus[^"]*"[^>]*data-locus-from="5r"[^>]*>ff\. 5r-9v</);
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
