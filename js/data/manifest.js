// Single source of truth for the per-language data artifacts the frontend loads.
//
// Background: the old `RAW_EXCEL_SOURCES` (legacy table.js) hardcoded *versioned*
// filenames with prefixes that disagreed within a single source (e.g. a `1.2_` TSV
// paired with a `1.3_` merges file). Because rows and merge geometry are joined by
// `__sourceRowIndex`, a TSV/merges pair from different pipeline versions silently
// mis-merges cells. This manifest fixes that: tsv + merges are derived from one
// coherent, unversioned stem (matching current pipeline output), so a source can
// never reference a mismatched pair.
//
// Open item — segments: the pipeline does not yet emit unversioned
// `Metadata_<Lang>_segments.json`; only versioned files exist on disk. Until the
// pipeline is updated, each source pins `segmentsFile` to the version that exists.
// When unversioned segments are produced, drop `segmentsFile` and derive it from
// the stem like tsv/merges. See docs/SEARCH_REWRITE_PLAN.md (Open questions).

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
  // `segmentsFile` is the *existing* (versioned) segments artifact per language.
  { id: "dan", lang: "da", stem: "Metadata_Dan", segmentsFile: "1.0_Metadata_Dan_segments.json" },
  { id: "isl", lang: "is", stem: "Metadata_Isl", segmentsFile: "1.1_Metadata_Isl_segments.json" },
  { id: "norw", lang: "no", stem: "Metadata_Norw", segmentsFile: "1.2_Metadata_Norw_segments.json" },
  { id: "swe", lang: "sv", stem: "Metadata_Swe", segmentsFile: "1.1_Metadata_Swe_segments.json" },
].map(({ segmentsFile, ...s }) => ({
  ...s,
  tsv: `${DATA_DIR}/${s.stem}_raw.tsv`,
  merges: `${DATA_DIR}/${s.stem}_raw_merges.json`,
  segments: `${DATA_DIR}/${segmentsFile}`,
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
