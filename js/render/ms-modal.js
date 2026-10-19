// Manuscript details modal, built from the *_segments.json data. Grouped into
// Header / Content / Physical Description / History / Bibliography sections.
//
// Main/Minor text are expanded via the shared model/expand.js.

import { escapeHtml, normalizeForCompare } from "../util/text.js";
import { aggregateFieldValues } from "../model/manuscript.js";
import { expandMainText, expandMinorText, mainCandidatesFrom } from "../model/expand.js";
import { renderLinksHtml } from "./links.js";
import { LANGUAGE_MAP } from "../model/fields.js";
import { sourceById } from "../data/manifest.js";
import { columnTitle as colTitle } from "../config.js";


const CONTENT_COLS = ["Main text", "Minor text"];
const PHYSICAL_COLS = [
  "Gatherings", "Full size", "Leaf size", "Catch Words and Gatherings", "Pricking",
  "Material", "Ruling", "Columns", "Lines", "Script", "Rubric", "Scribe",
  "Production Unit", "Production", "Style", "Colours", "Form of Initials",
  "Size of Initials", "Iconography",
];
const HISTORY_COLS = ["Dating", "Place", "Related Shelfmarks"];
const BIBLIOGRAPHY_COLS = ["Literature", "Links to Database"];

const OMIT_LOCUS = new Set(["Full size", "Literature", "Links to Database"]);
const ALWAYS_LOCUS = new Set(["Main text", "Minor text"]);

/** Collapse a locus range where from == to, e.g. "f. 1r-1r" => "f. 1r". */
function normalizeRenderedLocus(locusText) {
  const raw = String(locusText || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const m = raw.match(/^(\s*(?:ff?|pp?)\.\s*)(.+?)\s*[-–]\s*(.+?)\s*$/i);
  if (m) {
    const prefix = String(m[1] || "");
    const from = String(m[2] || "").trim();
    const to = String(m[3] || "").trim();
    if (from && to && normalizeForCompare(from) === normalizeForCompare(to)) {
      return `${prefix}${from}`.replace(/\s+/g, " ").trim();
    }
    return raw;
  }
  const m2 = raw.match(/^(.+?)\s*[-–]\s*(.+?)\s*$/);
  if (m2) {
    const from = String(m2[1] || "").trim();
    const to = String(m2[2] || "").trim();
    if (from && to && normalizeForCompare(from) === normalizeForCompare(to)) return from;
  }
  return raw;
}

function pickFirstNonEmptySegmentLabel(ms, col) {
  const segs = ms && ms.segmentsByColumn && Array.isArray(ms.segmentsByColumn[col]) ? ms.segmentsByColumn[col] : [];
  for (const s of segs) {
    if (normalizeForCompare(s && s.label !== undefined ? s.label : "")) return String(s.label);
  }
  return "";
}

function expandDepositoryLabel(raw, depositoryMap) {
  const d = String(raw || "").trim();
  if (!d) return "";
  if (depositoryMap && Object.prototype.hasOwnProperty.call(depositoryMap, d)) {
    return String(depositoryMap[d] || "").trim() || d;
  }
  return d;
}

function renderColumnBlock(ms, col, ctx) {
  const byCol = ms && ms.segmentsByColumn ? ms.segmentsByColumn : null;
  const segs = (byCol && Array.isArray(byCol[col]) ? byCol[col] : []).filter((s) =>
    normalizeForCompare(s && s.label !== undefined ? s.label : "")
  );

  // Prefer the manuscript-level merged raw value for Links (segments can hold
  // label-only fragments from merged cells).
  if (col === "Links to Database") {
    const rawBlock = ctx.msKey ? ctx.rawByKey && ctx.rawByKey.get(ctx.msKey) : null;
    const rows = rawBlock && Array.isArray(rawBlock.rows) ? rawBlock.rows : null;
    if (rows && rows.length) {
      const html = renderLinksHtml(aggregateFieldValues(rows, "Links to Database", "; "));
      if (normalizeForCompare(html)) {
        return `<div class="mb-3"><div class="fw-bold">${escapeHtml(colTitle(col))}</div><div class="mb-1"><div class="text-break">${html}</div></div></div>`;
      }
    }
  }

  if (!segs.length) return "";
  const showLocus = !OMIT_LOCUS.has(col) && (ALWAYS_LOCUS.has(col) || segs.length > 1);

  const maps = ctx && ctx.maps;
  let mainCands = null;
  if (col === "Minor text" && maps) {
    const mainSegs = byCol && Array.isArray(byCol["Main text"]) ? byCol["Main text"] : [];
    const acc = [];
    for (const s of mainSegs) {
      const mv = normalizeForCompare(s && s.label !== undefined ? s.label : "");
      if (mv) acc.push(...mainCandidatesFrom(mv));
    }
    const seen = new Set();
    mainCands = acc.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
  }

  const expandLabel = (label) => {
    if (col === "Main text" && maps) return expandMainText(label, maps);
    if (col === "Minor text" && maps) return expandMinorText(label, mainCands || [], maps);
    return String(label || "");
  };

  const items = segs
    .map((s) => {
      const locusText = normalizeRenderedLocus(s.locus && s.locus.rendered ? String(s.locus.rendered) : "");
      const valueHtml = col === "Links to Database" ? renderLinksHtml(s.label) : escapeHtml(expandLabel(s.label));
      if (!showLocus) return `<div class="mb-1"><div class="text-break">${valueHtml}</div></div>`;
      return `<div class="d-flex gap-2 mb-1"><div class="text-secondary small" style="min-width:110px;">${escapeHtml(locusText)}</div><div class="text-break flex-grow-1">${valueHtml}</div></div>`;
    })
    .join("");

  return `<div class="mb-3"><div class="fw-bold">${escapeHtml(colTitle(col))}</div>${items}</div>`;
}

function renderColumns(ms, cols, ctx) {
  const out = cols.map((c) => renderColumnBlock(ms, c, ctx)).filter(Boolean);
  return out.length ? out.join("") : '<div class="text-secondary">No data.</div>';
}

function section(title, bodyHtml) {
  return `<div class="mb-4"><h5 class="mb-2">${escapeHtml(title)}</h5>${bodyHtml}</div>`;
}

/** Build the modal body HTML for a segments-manuscript object. */
export function buildManuscriptModalHtml(ms, ctx) {
  const shelfmark = ms && ms.Shelfmark ? String(ms.Shelfmark) : "";
  const depository = expandDepositoryLabel(ms && ms.Depository ? String(ms.Depository) : "", ctx.depositoryMap);

  const headerRows = [
    ["Depository", escapeHtml(depository || "—")],
    ["Shelfmark", escapeHtml(shelfmark || "—")],
  ];
  for (const [label, col] of [["Language", "Language"], ["Name", "Name"], ["Object", "Object"], ["Size", "Size"]]) {
    let v = pickFirstNonEmptySegmentLabel(ms, col);
    // Segments rarely carry a Language column; fall back to the source's language.
    if (!v && col === "Language") {
      const src = ctx.sourceId ? sourceById(ctx.sourceId) : null;
      if (src) v = LANGUAGE_MAP[src.lang] || src.lang;
    }
    if (v) headerRows.push([label, escapeHtml(v)]);
  }
  const headerTable =
    `<table class="table table-sm mb-0"><tbody>` +
    headerRows.map(([k, v]) => `<tr><th style="width:140px;" class="text-secondary">${escapeHtml(k)}</th><td class="text-break">${v}</td></tr>`).join("") +
    `</tbody></table>`;

  return [
    section("Header", headerTable),
    section("Content", renderColumns(ms, CONTENT_COLS, ctx)),
    section("Physical Description", renderColumns(ms, PHYSICAL_COLS, ctx)),
    section("History", renderColumns(ms, HISTORY_COLS, ctx)),
    section("Bibliography", renderColumns(ms, BIBLIOGRAPHY_COLS, ctx)),
  ].join("");
}

function showModal(modalEl) {
  const bs = typeof window !== "undefined" ? window.bootstrap : null;
  if (bs && bs.Modal) bs.Modal.getOrCreateInstance(modalEl).show();
}

/**
 * Open the details modal for a manuscript.
 * @param {{sourceId:string, msKey:string}} target
 * @param {{indexBySource:Map, depositoryMap:object, rawByKey:Map}} deps
 */
export function openManuscriptModal(target, deps) {
  const { sourceId, msKey } = target;
  const { indexBySource, depositoryMap, rawByKey, maps = null } = deps;
  const modalEl = document.getElementById("msDetailsModal");
  const contentDiv = document.getElementById("ms-details-content");
  const titleEl = document.getElementById("msDetailsModalLabel");
  if (!modalEl || !contentDiv) return false;

  const idx = sourceId ? indexBySource.get(sourceId) : null;
  const ms = idx && msKey ? idx.get(msKey) : null;
  if (!ms) {
    if (titleEl) titleEl.textContent = "Manuscript";
    contentDiv.innerHTML = '<div class="text-secondary">No segments found for this manuscript.</div>';
    showModal(modalEl);
    return false;
  }

  const shelfmark = ms.Shelfmark ? String(ms.Shelfmark) : "";
  const dep = expandDepositoryLabel(ms.Depository ? String(ms.Depository) : "", depositoryMap);
  if (titleEl) titleEl.textContent = dep && shelfmark ? `${dep} — ${shelfmark}` : "Manuscript";

  contentDiv.innerHTML = buildManuscriptModalHtml(ms, { msKey, sourceId, rawByKey, depositoryMap, maps });
  // Filename for the PDF export (wired in the next step).
  modalEl.dataset.filename = `${(dep || "").replace(/[\\/:*?"<>|]+/g, "-").trim()}_${(shelfmark || "").replace(/[\\/:*?"<>|]+/g, "-").trim()}.pdf`;
  showModal(modalEl);
  return true;
}
