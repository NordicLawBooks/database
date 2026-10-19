import { test } from "node:test";
import assert from "node:assert/strict";
import { buildManuscriptModalHtml } from "../js/render/ms-modal.js";

const ms = {
  Depository: "AM",
  Shelfmark: "1",
  segmentsByColumn: {
    "Main text": [{ label: "Code", locus: { rendered: "f. 5r-5r" } }], // always-locus, collapses
    Script: [{ label: "Gothic", locus: { rendered: "f. 1r-9v" } }], // single, non-always -> no locus
    Lines: [
      { label: "20", locus: { rendered: "f. 1r" } },
      { label: "25", locus: { rendered: "f. 2r" } },
    ],
    Literature: [{ label: "" }], // empty -> dropped
  },
};

test("buildManuscriptModalHtml renders all five sections", () => {
  const html = buildManuscriptModalHtml(ms, { msKey: "AM||1", rawByKey: new Map(), depositoryMap: {} });
  for (const s of ["Header", "Content", "Physical Description", "History", "Bibliography"]) {
    assert.match(html, new RegExp(`<h5[^>]*>${s}</h5>`));
  }
});

test("shows labels and the (raw) depository + shelfmark", () => {
  const html = buildManuscriptModalHtml(ms, { msKey: "AM||1", rawByKey: new Map(), depositoryMap: {} });
  assert.match(html, /Code/);
  assert.match(html, /Gothic/);
  assert.match(html, />AM</); // depository, unmapped
  assert.match(html, />1</); // shelfmark
});

test("expands depository via the map when present", () => {
  const html = buildManuscriptModalHtml(ms, { msKey: "AM||1", rawByKey: new Map(), depositoryMap: { AM: "Arnamagnæan Collection" } });
  assert.match(html, /Arnamagnæan Collection/);
});

test("collapses an equal-endpoint locus (Main text always shows locus)", () => {
  const html = buildManuscriptModalHtml(ms, { msKey: "AM||1", rawByKey: new Map(), depositoryMap: {} });
  assert.match(html, /f\. 5r/);
  assert.doesNotMatch(html, /5r-5r/);
});

test("Language falls back to the source language when segments lack it", () => {
  const html = buildManuscriptModalHtml(ms, { msKey: "AM||1", sourceId: "isl", rawByKey: new Map(), depositoryMap: {} });
  assert.match(html, />Language<\/th><td[^>]*>Icelandic</);
  const withLang = { ...ms, segmentsByColumn: { ...ms.segmentsByColumn, Language: [{ label: "Latin" }] } };
  assert.match(buildManuscriptModalHtml(withLang, { msKey: "AM||1", sourceId: "isl", rawByKey: new Map(), depositoryMap: {} }), />Latin</);
  assert.doesNotMatch(buildManuscriptModalHtml(ms, { msKey: "AM||1", rawByKey: new Map(), depositoryMap: {} }), />Language</);
});
