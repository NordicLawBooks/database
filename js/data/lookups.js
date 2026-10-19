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

let textsMaps = null;

/**
 * Parse texts.tsv into { main, minor }. Each line is
 * `mainAbbr \t sectionAbbr \t expansion`; an empty section populates `main`,
 * otherwise `minor` (keyed by minorTextKey(main, section)). A 2-column legacy
 * line falls back to `main`.
 */
export async function loadTextsMaps() {
  if (textsMaps) return textsMaps;
  const main = {};
  const minor = {};
  try {
    const resp = await fetch(`${DATA_DIR}/texts.tsv`);
    const text = await resp.text();
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      const cols = line.replace(/^﻿/, "").split("\t");
      if (cols.length >= 3) {
        const mainAbbr = (cols[0] || "").trim();
        const section = (cols[1] || "").trim();
        const full = (cols[2] || "").trim();
        if (!mainAbbr || !full) continue;
        if (!section) main[mainAbbr] = full;
        else minor[minorTextKey(mainAbbr, section)] = full;
      } else if (cols.length === 2) {
        const a = (cols[0] || "").trim();
        const f = (cols[1] || "").trim();
        if (a && f) main[a] = f;
      }
    }
  } catch (e) {
    console.error("Failed to load texts.tsv:", e);
  }
  textsMaps = { main, minor };
  return textsMaps;
}

/** Combined expansion maps { abbr, main, minor } for the renderers. */
export async function loadExpansionMaps() {
  const [abbr, t] = await Promise.all([loadAbbreviationsMap(), loadTextsMaps()]);
  return { abbr, main: t.main, minor: t.minor };
}
