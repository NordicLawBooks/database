// Shared renderer for "Links to Database" cells: a "; "-separated list where each
// part may be a Markdown link [label](url) or plain text. De-duplicates, escapes.

import { escapeHtml, splitSemicolonList } from "../util/text.js";

const MD_LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;

export function renderLinksHtml(value) {
  const parts = splitSemicolonList(value);
  if (!parts.length) return "";
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    const m = p.match(MD_LINK_RE);
    out.push(
      m
        ? `<a href="${escapeHtml(m[2])}" target="_blank" rel="noopener">${escapeHtml(m[1])}</a>`
        : escapeHtml(p)
    );
  }
  return out.join("; ");
}
