import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTextsTsv } from "../js/data/lookups.js";
import { groupTexts, buildAbbreviationsHtml } from "../js/render/abbr-modal.js";

test("parseTextsTsv reads main texts, sections and legacy 2-column lines", () => {
  const rows = parseTextsTsv("﻿GuL\t\tGulatingsloven\r\nGuL\tKrb\tKristendomsbolk \n\nK\tKristinréttr\nbad\t\t\n");
  assert.deepEqual(rows, [
    { main: "GuL", section: "", full: "Gulatingsloven" },
    { main: "GuL", section: "Krb", full: "Kristendomsbolk" },
    { main: "K", section: "", full: "Kristinréttr" },
  ]);
});

test("groupTexts nests sections under their main text, in file order", () => {
  const groups = groupTexts([
    { main: "GuL", section: "Krb", full: "Kristendomsbolk" },
    { main: "GuL", section: "", full: "Gulatingsloven" },
    { main: "K", section: "", full: "Kristinréttr" },
  ]);
  assert.deepEqual(groups, [
    { abbr: "GuL", full: "Gulatingsloven", sections: [{ abbr: "Krb", full: "Kristendomsbolk" }] },
    { abbr: "K", full: "Kristinréttr", sections: [] },
  ]);
});

test("buildAbbreviationsHtml escapes values and labels sections with their main text", () => {
  const html = buildAbbreviationsHtml({
    depositories: { KB: "National Library of Sweden" },
    texts: [{ abbr: "GuL", full: "Gulatingsloven", sections: [{ abbr: "Krb", full: "<Kristendomsbolk>" }] }],
    general: { ON: "Old Norse" },
  });
  assert.match(html, /<th scope="row">KB<\/th><td>National Library of Sweden<\/td>/);
  assert.match(html, /<th scope="row">GuL Krb<\/th><td>&lt;Kristendomsbolk&gt;<\/td>/);
  assert.match(html, /<th scope="row">ON<\/th><td>Old Norse<\/td>/);
});
