// Shared renderer for "Links to Database" cells: a list separated by ";" or
// newlines where each part may be a Markdown link [label](url), a bare URL, or
// plain text. Short database labels (HR, MS, …) are expanded; de-duplicates, escapes.
// iiifIconsHtml: the IIIF icon links shown after the Shelfmark (js/model/iiif.js);
// leavesLinkHtml: each folio in a Leaves/Pages value as a link into the viewer.

import { escapeHtml, normalizeForCompare } from "../util/text.js";
import { manifestsForLinks, leavesTokens } from "../model/iiif.js";

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

/**
 * IIIF logo links, one per indexed manifest among `linksValue`'s links. A click
 * opens the image viewer (main.js); the href (manifest?manifest=manifest, the
 * IIIF drag-and-drop convention) lets the icon be dragged into another viewer.
 */
export function iiifIconsHtml(linksValue) {
  return manifestsForLinks(linksValue)
    .map((e) => {
      const href = `${e.manifest}?manifest=${encodeURIComponent(e.manifest)}`;
      return `<a href="${escapeHtml(href)}" class="iiif-open" data-iiif-manifest="${escapeHtml(e.manifest)}" ` +
        `title="View images (IIIF; drag the icon into another IIIF viewer)">` +
        `<img src="img/iiif.svg" alt="IIIF images" width="23" height="12"></a>`;
    })
    .join("");
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

/**
 * `text` with each folio in it (leavesTokens) as a link opening `manifest`
 * there; plain escaped text when there is no manifest or no folio.
 */
export function folioLinksHtml(text, manifest) {
  const tokens = leavesTokens(text);
  if (!manifest || !tokens.some((t) => t.folio)) return escapeHtml(text == null ? "" : String(text));
  const m = escapeHtml(manifest);
  return tokens
    .map(({ text: t, folio }) =>
      folio
        ? `<a href="#" class="iiif-locus link-secondary" data-iiif-manifest="${m}" ` +
          `data-locus-from="${escapeHtml(folio)}" title="View f. ${escapeHtml(folio)} in the image viewer">${escapeHtml(t)}</a>`
        : escapeHtml(t)
    )
    .join("");
}

/** A Leaves/Pages text (normalised for display), linked to the first manifest of `linksValue`. */
export function leavesLinkHtml(text, linksValue) {
  const first = leavesTokens(text).some((t) => t.folio) ? manifestsForLinks(linksValue)[0] : null;
  return folioLinksHtml(text, first && first.manifest);
}
