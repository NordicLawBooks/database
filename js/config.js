// Minimal configuration surface needed by the state store and URL layers.
//
// Step 4 grows this into the full declarative FACET_DEFS; these lists will then
// be derived from it. The names here are stable, so that refactor won't churn
// the store/URL code or their tests.

export const DEFAULT_VIEW = "merged";
export const DEFAULT_SORT = "shelfmark";
/** The sort a state has when none is named: Relevance during a search, else Shelfmark. */
export const defaultSortFor = (query) => (String(query || "").trim() ? "relevance" : DEFAULT_SORT);
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;

const COLUMN_TITLE_OVERRIDES = { "Shelf mark": "Shelfmark" };
/** Display title for a field name (column headers, column menu, modals). */
export const columnTitle = (field) => COLUMN_TITLE_OVERRIDES[field] || field;

// Declarative facet definitions — the single source of truth for the facet
// engine, the sidebar renderer (Step 5), and the lists derived below.
//
// type:
//   "term"          single value per row (getFacetValue); scope "row" (default)
//                   or "manuscript" (value derived per manuscript, e.g. Production units)
//   "multi"         semicolon/newline-separated tokens (Minor text)
//   "hierarchical"  parent group + a childField of "group|variant" keys
//   "range"         numeric {min,max} only, no checkboxes (Dating)
//   "range+terms"   numeric {min,max} plus free-text checkbox values (Lines)
// emptyOption: blanks become a selectable "Empty" option.
// searchable: the sidebar shows a box that filters the (long) option list.
// help: one-line hint shown above a facet's range inputs.
export const FACET_DEFS = [
  { field: "Language", type: "term" },
  { field: "Depository", type: "term", emptyOption: true },
  { field: "Object", type: "term", emptyOption: true },
  { field: "Material", type: "term", emptyOption: true },
  { field: "Size", type: "term", emptyOption: true },
  { field: "Production units", type: "term", scope: "manuscript" },
  { field: "Main text group", type: "hierarchical", childField: "Main text group-variant",
    label: "Main text", searchable: true },
  { field: "Minor text", type: "multi", searchable: true },
  { field: "Dating", type: "range", minField: "DatingMinYear", maxField: "DatingMaxYear",
    help: "Filter by year range (uses parsed year from Dating)" },
  { field: "Script", type: "term", emptyOption: true },
  { field: "Pricking", type: "term", emptyOption: true },
  { field: "Ruling", type: "term", emptyOption: true },
  { field: "Columns", type: "term", emptyOption: true },
  { field: "Lines", type: "range+terms", emptyOption: true,
    help: "Filter by line count range (parses numbers/ranges; ignores parentheses and ca.)" },
  { field: "Rubric", type: "term", emptyOption: true },
  { field: "Style", type: "term", emptyOption: true, label: "Decoration style" },
];

// Fields that carry array selections in state.facets (everything except a
// range-only facet). Dating is range-only, so it's excluded. Lines appears here
// (its text values) AND in RANGE_KEYS (its numeric range). Hierarchical facets
// contribute both their parent field and their childField.
export const FACET_KEYS = (() => {
  const keys = [];
  for (const d of FACET_DEFS) {
    if (d.type === "range") continue;
    keys.push(d.field);
    if (d.childField) keys.push(d.childField);
  }
  return keys;
})();

// Fields that carry a numeric {min, max} range in state.ranges.
export const RANGE_KEYS = FACET_DEFS.filter(
  (d) => d.type === "range" || d.type === "range+terms"
).map((d) => d.field);

// Canonical display order for table columns (matches the TSV export order, with
// Language injected). Columns not in this list fall to the end in header order.
export const COLUMN_ORDER = [
  "Depository",
  "Shelf mark",
  "Language",
  "Name",
  "Object",
  "Size",
  "Production Unit",
  "Leaves/Pages",
  "Main text",
  "Minor text",
  "Dating",
  "Gatherings",
  "Full size",
  "Leaf size",
  "Catch Words and Gatherings",
  "Pricking",
  "Material",
  "Ruling",
  "Columns",
  "Lines",
  "Script",
  "Rubric",
  "Scribe",
  "Production",
  "Style",
  "Colours",
  "Form of Initials",
  "Size of Initials",
  "Iconography",
  "Place",
  "Related Shelfmarks",
  "Literature",
  "Links to Database",
];

// Column-visibility presets (ported from the legacy app). "textual" is the
// default shown on first load for both views.
export const COLUMN_PRESETS = {
  minimal: ["Depository", "Shelf mark", "Name", "Language", "Production Unit", "Dating", "Material", "Links to Database"],
  textual: ["Depository", "Shelf mark", "Language", "Production Unit", "Leaves/Pages", "Main text", "Minor text", "Dating"],
  codicology: ["Depository", "Shelf mark", "Language", "Object", "Material", "Size", "Leaves/Pages", "Gatherings", "Full size", "Leaf size", "Catch Words and Gatherings", "Pricking", "Ruling", "Production Unit", "Production"],
  layout: ["Depository", "Shelf mark", "Language", "Columns", "Lines", "Ruling", "Rubric", "Style", "Colours", "Form of Initials", "Size of Initials", "Iconography", "Place"],
};

export const DEFAULT_COLUMN_PRESET = "textual";

// Buttons shown in the column menu, in order. "all" => show everything.
export const COLUMN_PRESET_BUTTONS = [
  { action: "all", label: "All" },
  { action: "minimal", label: "Minimal" },
  { action: "textual", label: "Textual content" },
  { action: "codicology", label: "Codicology" },
  { action: "layout", label: "Layout & decoration" },
  { action: "reset", label: "Reset" },
];

/** A preset's columns intersected with the available ones; null for "all". */
export function getPreset(name, allColumns) {
  const p = COLUMN_PRESETS[name];
  if (!p) return null;
  const set = new Set(p);
  return allColumns.filter((c) => set.has(c));
}

// Internal/derived fields hidden from the UI column lists.
export const HIDDEN_FIELDS = new Set([
  "Century",
  "DatingYear",
  "DatingMinYear",
  "DatingMaxYear",
  "Main text group",
  "Depository_abbr",
]);

// Short, stable URL keys for the longest field names. Fields not listed here use
// their real name in the URL (e.g. "f.Minor text"). Range fields use a separate
// lowercase key (see js/url.js), so they never collide with their "f." facet key.
export const URL_ALIASES = {
  "Main text group": "mtg",
  "Main text group-variant": "mtgv",
  "Production units": "pu",
};
