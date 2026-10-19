import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLinkLabel, splitLinks, renderLinksHtml } from "../js/render/links.js";

test("formatLinkLabel: exact and prefix expansion, leaves longer tokens alone", () => {
  assert.equal(formatLinkLabel("HR"), "Handrit.is");
  assert.equal(formatLinkLabel("cf"), "Codices Fennici");
  assert.equal(formatLinkLabel("MS (Not digitalised)"), "manuscripta.se (Not digitalised)");
  assert.equal(formatLinkLabel("MSS"), "MSS");
  assert.equal(formatLinkLabel("NorS"), "NorS");
});

test("splitLinks: semicolons + newlines, drops Unavailable, bare labels covered by a link, duplicates", () => {
  assert.deepEqual(
    splitLinks("[HR](https://h/1); HR\nNorS; Unavailable; NorS"),
    ["[HR](https://h/1)", "NorS"]
  );
  assert.deepEqual(splitLinks(""), []);
  assert.deepEqual(splitLinks(null), []);
});

test("renderLinksHtml: expanded label on links, bare URLs linked, non-http not linked", () => {
  const html = renderLinksHtml("[HR](https://handrit.is/x); https://alvin/y; [AV](javascript:void0); MS");
  assert.match(html, /<a href="https:\/\/handrit\.is\/x"[^>]*>Handrit\.is<\/a>/);
  assert.match(html, /<a href="https:\/\/alvin\/y"[^>]*>https:\/\/alvin\/y<\/a>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /; Alvin; manuscripta\.se$/);
  assert.equal(renderLinksHtml(""), "");
});
