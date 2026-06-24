// Facet sidebar: build the controls once from the option universe, then sync
// counts + checked/range state on every render (rebuilding innerHTML each time
// would blur range inputs and reset accordion state).

import { escapeHtml, toDomIdToken, compareValues } from "../util/text.js";
import { FACET_DEFS } from "../config.js";

const VARIANT_KEY = "Main text group-variant";
const sorted = (map) => [...map.keys()].sort(compareValues);

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
    `<div class="form-check">` +
    `<input class="form-check-input" type="checkbox" id="${id}" ` +
    `data-facet-field="${escapeHtml(field)}" data-facet-value="${escapeHtml(value)}">` +
    `<label class="form-check-label" for="${id}">${escapeHtml(label)} ` +
    `<span class="facet-count text-secondary" data-count-field="${escapeHtml(field)}" ` +
    `data-count-value="${escapeHtml(value)}"></span></label></div>`
  );
}

function rangeInputs(field) {
  const f = escapeHtml(field);
  return (
    `<div class="d-flex gap-2 align-items-center mb-1">` +
    `<input type="number" inputmode="numeric" class="form-control form-control-sm" placeholder="from" ` +
    `data-range-field="${f}" data-range-bound="min" aria-label="${f} from">` +
    `<span class="text-secondary">–</span>` +
    `<input type="number" inputmode="numeric" class="form-control form-control-sm" placeholder="to" ` +
    `data-range-field="${f}" data-range-bound="max" aria-label="${f} to">` +
    `</div>`
  );
}

function bodyHtml(def, universe) {
  if (def.type === "range") return rangeInputs(def.field);

  if (def.type === "hierarchical") {
    const { groups, byGroup } = universe[def.field];
    return groups
      .map((g) => {
        const variants = (byGroup[g] || [])
          .map((key) => `<div class="ms-3">${checkbox(def.childField, key, key.slice(key.indexOf("|") + 1) || "—")}</div>`)
          .join("");
        return checkbox(def.field, g, g) + variants;
      })
      .join("");
  }

  let html = def.type === "range+terms" ? rangeInputs(def.field) : "";
  html += (universe[def.field] || []).map((v) => checkbox(def.field, v, v)).join("");
  return html;
}

/** Build the accordion once. `counts` is the unfiltered universe of options. */
export function buildFacetSidebar(host, counts) {
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
      `<div class="accordion-body py-2">${bodyHtml(def, universe)}</div>` +
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
}

/** Wire delegated change/input handlers that push updates into the store. */
export function bindFacetEvents(host, store) {
  host.addEventListener("change", (e) => {
    const t = e.target;
    if (!t.matches("input[type=checkbox][data-facet-field]")) return;
    const { facetField, facetValue } = t.dataset;
    const state = store.get();
    const cur = state.facets[facetField] || [];
    const next = cur.includes(facetValue) ? cur.filter((v) => v !== facetValue) : [...cur, facetValue];
    store.set({ page: 1, facets: { ...state.facets, [facetField]: next } }, { history: "push" });
  });

  host.addEventListener("input", (e) => {
    const t = e.target;
    if (!t.matches("input[data-range-field]")) return;
    const { rangeField, rangeBound } = t.dataset;
    const raw = t.value.trim();
    let val = raw === "" ? null : Number(raw);
    if (val !== null && !Number.isFinite(val)) val = null;
    const state = store.get();
    store.set(
      { page: 1, ranges: { ...state.ranges, [rangeField]: { ...state.ranges[rangeField], [rangeBound]: val } } },
      { history: "replace" }
    );
  });
}
