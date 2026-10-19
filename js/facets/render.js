// Facet sidebar: build the controls once from the option universe, then sync
// counts + checked/range state on every render (rebuilding innerHTML each time
// would blur range inputs and reset accordion state).

import { escapeHtml, toDomIdToken, compareValues, fold } from "../util/text.js";
import { FACET_DEFS } from "../config.js";
import { formatAbbrExpansion } from "../model/expand.js";
import { debounce } from "../util/debounce.js";

const VARIANT_KEY = "Main text group-variant";
const sorted = (map) => [...map.keys()].sort(compareValues);
const DEF_BY_FIELD = new Map(FACET_DEFS.map((d) => [d.field, d]));

/** The state.facets keys a facet owns (a hierarchical facet also owns its childField). */
function selectionKeys(field) {
  const def = DEF_BY_FIELD.get(field);
  return def && def.childField ? [field, def.childField] : [field];
}

/** True when the facet has no checkbox selection, i.e. "All" (unfiltered). */
export function isFacetUnfiltered(facets, field) {
  return selectionKeys(field).every((k) => !(facets[k] || []).length);
}

/** `facets` with the given facet's checkbox selection cleared (ranges untouched). */
export function clearFacetSelection(facets, field) {
  const next = { ...facets };
  for (const k of selectionKeys(field)) next[k] = [];
  return next;
}

/** Option-list search: folded substring match (Nordic-aware, case/diacritic-insensitive). */
export function matchesOptionSearch(value, query) {
  const q = fold(query).trim();
  return !q || fold(value).includes(q);
}

/** Derive the stable option universe for each facet from unfiltered counts. */
function optionUniverse(counts) {
  const u = {};
  for (const def of FACET_DEFS) {
    if (def.type === "range") continue;
    if (def.type === "hierarchical") {
      const groups = sorted(counts[def.field].counts);
      const byGroup = {};
      for (const g of groups) byGroup[g] = [];
      for (const key of sorted(counts[def.childField].counts)) {
        const g = key.slice(0, key.indexOf("|"));
        (byGroup[g] = byGroup[g] || []).push(key);
      }
      u[def.field] = { groups, byGroup };
    } else {
      u[def.field] = sorted(counts[def.field].counts);
    }
  }
  return u;
}

function checkbox(field, value, label) {
  const id = `facet_${toDomIdToken(field)}_${toDomIdToken(value)}`;
  return (
    `<div class="form-check" data-option-label="${escapeHtml(label)}">` +
    `<input class="form-check-input" type="checkbox" id="${id}" ` +
    `data-facet-field="${escapeHtml(field)}" data-facet-value="${escapeHtml(value)}">` +
    `<label class="form-check-label" for="${id}">${escapeHtml(label)} ` +
    `<span class="facet-count text-secondary" data-count-field="${escapeHtml(field)}" ` +
    `data-count-value="${escapeHtml(value)}"></span></label></div>`
  );
}

/** From/To inputs with the data's extent as placeholders, a help line, and a Clear button. */
function rangeInputs(def, extent) {
  const f = escapeHtml(def.field);
  const ph = (v) => (v == null ? "" : escapeHtml(String(v)));
  const box = (bound, label, v) =>
    `<div class="flex-fill">` +
    `<label class="form-label mb-1 range-label">${label}</label>` +
    `<input type="number" inputmode="numeric" class="form-control form-control-sm" placeholder="${ph(v)}" ` +
    `data-range-field="${f}" data-range-bound="${bound}" aria-label="${f} ${label.toLowerCase()}">` +
    `</div>`;
  return (
    (def.help ? `<div class="small text-secondary mb-2">${escapeHtml(def.help)}</div>` : "") +
    `<div class="d-flex gap-2 align-items-end mb-2">` +
    box("min", "From", extent && extent.min) +
    box("max", "To", extent && extent.max) +
    `<button class="btn btn-sm btn-outline-secondary" type="button" data-range-clear="${f}">Clear</button>` +
    `</div>`
  );
}

/** "All" box: ticked while the facet is unfiltered; ticking it clears the facet. */
function allCheckbox(field) {
  const id = `facet_${toDomIdToken(field)}__all`;
  const f = escapeHtml(field);
  return (
    `<div class="form-check mb-1">` +
    `<input class="form-check-input" type="checkbox" id="${id}" data-facet-all="${f}">` +
    `<label class="form-check-label" for="${id}">All ` +
    `<span class="facet-count text-secondary" data-count-all="${f}"></span></label></div>`
  );
}

/** Main text group / variant label: spelled out when texts.tsv knows the code (legacy). */
function mainTextLabel(code, maps) {
  return maps && maps.main && maps.main[code] ? formatAbbrExpansion(maps, code) : code;
}

function optionSearch(field) {
  const f = escapeHtml(field);
  return (
    `<div class="input-group input-group-sm mb-1">` +
    `<input type="search" class="form-control" placeholder="Search ${escapeHtml(field.toLowerCase())}s…" ` +
    `data-option-search="${f}" aria-label="Search ${f} options">` +
    `<button class="btn btn-outline-secondary" type="button" data-option-search-clear="${f}">Clear</button>` +
    `</div>` +
    `<div class="small text-secondary mb-1" data-option-search-status="${f}"></div>`
  );
}

function bodyHtml(def, universe, { maps, extents }) {
  if (def.type === "range") return rangeInputs(def, extents[def.field]);

  let options;
  if (def.type === "hierarchical") {
    const { groups, byGroup } = universe[def.field];
    options = groups
      .map((g) => {
        const variants = (byGroup[g] || [])
          .map((key) => {
            const variant = key.slice(key.indexOf("|") + 1);
            return `<div class="ms-3">${checkbox(def.childField, key, variant ? mainTextLabel(variant, maps) : "—")}</div>`;
          })
          .join("");
        return checkbox(def.field, g, mainTextLabel(g, maps)) + variants;
      })
      .join("");
  } else {
    options = (universe[def.field] || []).map((v) => checkbox(def.field, v, v)).join("");
  }

  let html = "";
  if (def.type === "range+terms") {
    html += rangeInputs(def, extents[def.field]);
    if (!options) return html; // no text values: range only, no All box (legacy)
    html += `<div class="small text-secondary mb-1">Text values</div>`;
  }
  if (def.searchable) html += optionSearch(def.field);
  html += allCheckbox(def.field);
  html += def.searchable
    ? `<div data-option-list="${escapeHtml(def.field)}" style="max-height: 320px; overflow: auto;">${options}</div>`
    : options;
  return html;
}

/** Show options matching the facet's search box (checked ones always stay visible). */
function applyOptionSearch(host, field) {
  const input = host.querySelector(`input[data-option-search="${CSS.escape(field)}"]`);
  const list = host.querySelector(`[data-option-list="${CSS.escape(field)}"]`);
  if (!input || !list) return;
  const opts = list.querySelectorAll(".form-check[data-option-label]");
  let shown = 0;
  for (const div of opts) {
    const checked = div.querySelector("input")?.checked;
    const visible = checked || matchesOptionSearch(div.dataset.optionLabel, input.value);
    div.style.display = visible ? "" : "none";
    if (visible) shown += 1;
  }
  const status = host.querySelector(`[data-option-search-status="${CSS.escape(field)}"]`);
  if (status) status.textContent = `${shown} of ${opts.length} shown`;
}

/**
 * Build the accordion once. `counts` is the unfiltered universe of options;
 * `maps` (expansion maps) spells out Main text group labels; `extents` holds each
 * range facet's data {min, max}, shown as input placeholders.
 */
export function buildFacetSidebar(host, counts, { maps = null, extents = {} } = {}) {
  const universe = optionUniverse(counts);
  const items = FACET_DEFS.map((def, i) => {
    const id = `facetAcc_${toDomIdToken(def.field)}`;
    const label = def.label || def.field;
    return (
      `<div class="accordion-item">` +
      `<h2 class="accordion-header">` +
      `<button class="accordion-button ${i === 1 ? "" : "collapsed"}" type="button" ` +
      `data-bs-toggle="collapse" data-bs-target="#${id}">${escapeHtml(label)}</button>` +
      `</h2>` +
      `<div id="${id}" class="accordion-collapse collapse ${i === 1 ? "show" : ""}">` +
      `<div class="accordion-body py-2">${bodyHtml(def, universe, { maps, extents })}</div>` +
      `</div></div>`
    );
  });
  host.innerHTML = `<div class="accordion accordion-flush">${items.join("")}</div>`;
}

/** Update count badges + checked/range state to match `state` and live `counts`. */
export function syncFacetSidebar(host, state, counts) {
  for (const cb of host.querySelectorAll("input[type=checkbox][data-facet-field]")) {
    const { facetField, facetValue } = cb.dataset;
    cb.checked = (state.facets[facetField] || []).includes(facetValue);
  }
  for (const cb of host.querySelectorAll("input[type=checkbox][data-facet-all]")) {
    cb.checked = isFacetUnfiltered(state.facets, cb.dataset.facetAll);
  }
  for (const span of host.querySelectorAll(".facet-count[data-count-all]")) {
    const c = counts[span.dataset.countAll];
    span.textContent = `(${(c && c.baseTotal) || 0})`;
  }
  for (const span of host.querySelectorAll(".facet-count[data-count-field]")) {
    const { countField, countValue } = span.dataset;
    const n = (counts[countField] && counts[countField].counts.get(countValue)) || 0;
    span.textContent = `(${n})`;
    span.closest(".form-check")?.classList.toggle("facet-zero", n === 0);
  }
  for (const input of host.querySelectorAll("input[data-range-field]")) {
    if (document.activeElement === input) continue; // don't fight the user mid-type
    const { rangeField, rangeBound } = input.dataset;
    const v = state.ranges[rangeField] ? state.ranges[rangeField][rangeBound] : null;
    input.value = v == null ? "" : String(v);
  }
  for (const def of FACET_DEFS) if (def.searchable) applyOptionSearch(host, def.field);
}

/** Wire delegated change/input handlers that push updates into the store. */
export function bindFacetEvents(host, store) {
  // Range typing is applied 200ms after the last keystroke (legacy); edits to
  // several inputs in that window are collected so none is lost.
  let pendingRanges = {};
  const flushRanges = debounce(() => {
    const pending = pendingRanges;
    pendingRanges = {};
    const state = store.get();
    const ranges = { ...state.ranges };
    for (const [field, bounds] of Object.entries(pending)) ranges[field] = { ...ranges[field], ...bounds };
    store.set({ page: 1, ranges }, { history: "replace" });
  }, 200);

  host.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("input[type=checkbox][data-facet-all]")) {
      const field = t.dataset.facetAll;
      const state = store.get();
      // Unticking "All" while unfiltered means nothing; keep it ticked.
      if (isFacetUnfiltered(state.facets, field)) { t.checked = true; return; }
      store.set({ page: 1, facets: clearFacetSelection(state.facets, field) }, { history: "push" });
      return;
    }
    if (!t.matches("input[type=checkbox][data-facet-field]")) return;
    const { facetField, facetValue } = t.dataset;
    const state = store.get();
    const cur = state.facets[facetField] || [];
    const next = cur.includes(facetValue) ? cur.filter((v) => v !== facetValue) : [...cur, facetValue];
    store.set({ page: 1, facets: { ...state.facets, [facetField]: next } }, { history: "push" });
  });

  host.addEventListener("click", (e) => {
    const clear = e.target.closest && e.target.closest("button[data-range-clear]");
    if (clear) {
      const field = clear.dataset.rangeClear;
      delete pendingRanges[field];
      const state = store.get();
      store.set({ page: 1, ranges: { ...state.ranges, [field]: { min: null, max: null } } }, { history: "push" });
      return;
    }
    const btn = e.target.closest && e.target.closest("button[data-option-search-clear]");
    if (!btn) return;
    const field = btn.dataset.optionSearchClear;
    const input = host.querySelector(`input[data-option-search="${CSS.escape(field)}"]`);
    if (input) input.value = "";
    applyOptionSearch(host, field);
  });

  host.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches("input[data-option-search]")) {
      applyOptionSearch(host, t.dataset.optionSearch);
      return;
    }
    if (!t.matches("input[data-range-field]")) return;
    const { rangeField, rangeBound } = t.dataset;
    const raw = t.value.trim();
    let val = raw === "" ? null : Number(raw);
    if (val !== null && !Number.isFinite(val)) val = null;
    pendingRanges[rangeField] = { ...pendingRanges[rangeField], [rangeBound]: val };
    flushRanges();
  });
}
