// Lazy, cached loaders for the hand-maintained lookup tables. Each returns a
// plain object map and caches the result (and the failure) so it is fetched once.

import { DATA_DIR } from "./manifest.js";
import { minorTextKey } from "../model/expand.js";

async function loadTsvMap(path) {
  const resp = await fetch(path);
  const text = await resp.text();
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const [key, value] = line.split(/\t/);
    if (key && value) map[key.trim()] = value.trim();
  }
  return map;
}

let depositoryMap = null;

/** abbreviation -> full institution name (data/depositories.tsv). */
export async function loadDepositoryMap() {
  if (depositoryMap) return depositoryMap;
  try {
    depositoryMap = await loadTsvMap(`${DATA_DIR}/depositories.tsv`);
  } catch (e) {
    console.error("Failed to load depositories.tsv:", e);
    depositoryMap = {};
  }
  return depositoryMap;
}

let abbrMap = null;

/** general abbreviation -> expansion (data/abbreviations.tsv). */
export async function loadAbbreviationsMap() {
  if (abbrMap) return abbrMap;
  try {
    abbrMap = await loadTsvMap(`${DATA_DIR}/abbreviations.tsv`);
  } catch (e) {
    console.error("Failed to load abbreviations.tsv:", e);
    abbrMap = {};
  }
  return abbrMap;
}

/**
 * Parse texts.tsv into rows `{ main, section, full }` in file order. Each line is
 * `mainAbbr \t sectionAbbr \t expansion`; an empty section is a main text,
 * otherwise a section of it. A 2-column legacy line is a main text.
 */
export function parseTextsTsv(text) {
  const rows = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const cols = line.replace(/^\uFEFF/, "").split("\t");
    if (cols.length >= 3) {
      const main = (cols[0] || "").trim();
      const section = (cols[1] || "").trim();
      const full = (cols[2] || "").trim();
      if (main && full) rows.push({ main, section, full });
    } else if (cols.length === 2) {
      const main = (cols[0] || "").trim();
      const full = (cols[1] || "").trim();
      if (main && full) rows.push({ main, section: "", full });
    }
  }
  return rows;
}

let textsRows = null;

/** texts.tsv as parsed rows (see parseTextsTsv). */
export async function loadTextsRows() {
  if (textsRows) return textsRows;
  try {
    const resp = await fetch(`${DATA_DIR}/texts.tsv`);
    textsRows = parseTextsTsv(await resp.text());
  } catch (e) {
    console.error("Failed to load texts.tsv:", e);
    textsRows = [];
  }
  return textsRows;
}

let textsMaps = null;

/**
 * texts.tsv as { main, minor }: main texts keyed by abbreviation, sections keyed
 * by minorTextKey(main, section).
 */
export async function loadTextsMaps() {
  if (textsMaps) return textsMaps;
  const main = {};
  const minor = {};
  for (const r of await loadTextsRows()) {
    if (!r.section) main[r.main] = r.full;
    else minor[minorTextKey(r.main, r.section)] = r.full;
  }
  textsMaps = { main, minor };
  return textsMaps;
}

/** Combined expansion maps { abbr, main, minor } for the renderers. */
export async function loadExpansionMaps() {
  const [abbr, t] = await Promise.all([loadAbbreviationsMap(), loadTextsMaps()]);
  return { abbr, main: t.main, minor: t.minor };
}
