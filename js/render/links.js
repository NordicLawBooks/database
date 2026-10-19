// Shared renderer for "Links to Database" cells: a list separated by ";" or
// newlines where each part may be a Markdown link [label](url), a bare URL, or
// plain text. Short database labels (HR, MS, …) are expanded; de-duplicates, escapes.

import { escapeHtml, normalizeForCompare } from "../util/text.js";

const MD_LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;
const HTTP_RE = /^https?:\/\//i;

/** Abbreviations used for link labels in the TSV/Excel exports. */
export const LINK_LABEL_MAP = {
  HR: "Handrit.is",
  MS: "manuscripta.se",
  AV: "Alvin",
  CF: "Codices Fennici",
};

/**
 * Expand a link label: exact match ("MS"), or prefix match when the next char
 * isn't alphanumeric ("MS (Not digitalised)" -> "manuscripta.se (Not digitalised)").
 */
export function formatLinkLabel(label) {
  const raw = label == null ? "" : String(label).trim();
  if (!raw) return raw;
  const upper = raw.toUpperCase();
  if (LINK_LABEL_MAP[upper]) return LINK_LABEL_MAP[upper];
  for (const k of Object.keys(LINK_LABEL_MAP)) {
    if (upper.startsWith(k)) {
      const next = raw.slice(k.length, k.length + 1);
      if (next === "" || /[^0-9A-Za-z]/.test(next)) return LINK_LABEL_MAP[k] + raw.slice(k.length);
    }
  }
  return raw;
}

/** Split a cell into unique parts; drops "Unavailable" and bare labels that a Markdown link already covers. */
export function splitLinks(value) {
  if (value == null) return [];
  const s = String(value).replace(/\r/g, "").trim();
  if (!s) return [];
  const parts = s.split(/[;\n]/).map((p) => p.trim()).filter((p) => p && p !== "Unavailable");

  // Excel exports can include both "[HR](url)" and a bare "HR"; keep only the link.
  const linkLabels = new Set();
  for (const p of parts) {
    const m = p.match(MD_LINK_RE);
    if (m) linkLabels.add(m[1].trim());
  }

  const seen = new Set();
  const out = [];
  for (const p of parts) {
    if (linkLabels.has(p)) continue;
    const key = normalizeForCompare(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function toLink(url, label) {
  const href = String(url || "").trim();
  if (!HTTP_RE.test(href)) return escapeHtml(label);
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

export function renderLinksHtml(value) {
  return splitLinks(value)
    .map((p) => {
      const m = p.match(MD_LINK_RE);
      if (m) return toLink(m[2], formatLinkLabel(m[1]));
      if (HTTP_RE.test(p)) return toLink(p, p);
      return escapeHtml(formatLinkLabel(p));
    })
    .join("; ");
}
