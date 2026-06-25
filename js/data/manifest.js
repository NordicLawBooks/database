// Single source of truth for the per-language data artifacts the frontend loads.
//
// Background: the old `RAW_EXCEL_SOURCES` (legacy table.js) hardcoded *versioned*
// filenames with prefixes that disagreed within a single source (e.g. a `1.2_` TSV
// paired with a `1.3_` merges file). Because rows and merge geometry are joined by
// `__sourceRowIndex`, a TSV/merges pair from different pipeline versions silently
// mis-merges cells. This manifest fixes that: all three artifacts (tsv, merges,
// segments) are derived from one unversioned stem, so a source can never reference
// a mismatched pair.

export const DATA_DIR = "data";

/**
 * @typedef {Object} Source
 * @property {string} id        Stable internal id ("dan" | "isl" | "norw" | "swe").
 * @property {string} lang      ISO language code injected into rows ("da"|"is"|"no"|"sv").
 * @property {string} stem      Unversioned filename stem (e.g. "Metadata_Dan").
 * @property {string} tsv       Path to the raw (Excel-identical) TSV.
 * @property {string} merges    Path to the rowspan/colspan merge geometry JSON.
 * @property {string} segments  Path to the per-manuscript segments JSON.
 */

/** @type {Source[]} */
export const SOURCES = [
  { id: "dan", lang: "da", stem: "Metadata_Dan" },
  { id: "isl", lang: "is", stem: "Metadata_Isl" },
  { id: "norw", lang: "no", stem: "Metadata_Norw" },
  { id: "swe", lang: "sv", stem: "Metadata_Swe" },
].map((s) => ({
  ...s,
  tsv:      `${DATA_DIR}/${s.stem}_raw.tsv`,
  merges:   `${DATA_DIR}/${s.stem}_raw_merges.json`,
  segments: `${DATA_DIR}/${s.stem}_segments.json`,
}));

/** Combined all-languages TSV; the fallback when raw sources can't be loaded. */
export const FALLBACK_TSV = `${DATA_DIR}/NordicLaw_data.tsv`;

const BY_LANG = new Map(SOURCES.map((s) => [s.lang, s]));
const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

/** @param {string} lang ISO code. @returns {Source|undefined} */
export function sourceByLang(lang) {
  return BY_LANG.get(lang);
}

/** @param {string} id internal source id. @returns {Source|undefined} */
export function sourceById(id) {
  return BY_ID.get(id);
}
