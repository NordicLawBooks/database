// One quire of a collation (model/collation.js) as an SVG string, in the style
// of VisColl collation diagrams: a shaded quire band, one horizontal line per
// leaf, conjoined leaves joined by nested folds at the spine (outermost
// bifolium leftmost), single leaves drawn with a short hook, folio labels on
// the right. Colours come from CSS custom properties set in index.html.

import { escapeHtml } from "../util/text.js";

const PITCH = 16; // vertical distance between leaves
const TOP = 30; // room for the quire label
const BOTTOM = 10;
const X0 = 14; // fold of the outermost bifolium
const STEP = 7; // horizontal step per nesting level
const LEAF = 80; // length of the straight part of a leaf
const MAX_RX = 14; // fold curvature

const r1 = (n) => Math.round(n * 10) / 10;

/** Plain-text summary of a quire, used for the SVG title. */
export function quireSummary(quire) {
  const parts = [`${quire.count} ${quire.count === 1 ? "leaf" : "leaves"}`];
  const comp = [];
  if (quire.bifolia) comp.push(`${quire.bifolia} ${quire.bifolia === 1 ? "bifolium" : "bifolia"}`);
  if (quire.singles) comp.push(`${quire.singles} single`);
  if (comp.length) parts[0] += ` (${comp.join(", ")})`;
  if (quire.folioRange) parts.push(`ff. ${quire.folioRange}`);
  return `Quire ${quire.label}: ${parts.join(", ")}`;
}

/** Pixel size of a quire's SVG. */
export function quireSize(quire) {
  const xRight = X0 + Math.max(quire.bifolia, 1) * STEP + LEAF;
  const longest = quire.leaves.reduce((m, l) => Math.max(m, String(l.folio || "").length), 0);
  return {
    xRight,
    width: Math.ceil(Math.max(xRight + 6 + longest * 7.5 + 8, 120)),
    height: TOP + quire.leaves.length * PITCH + BOTTOM,
  };
}

/**
 * @param {{label:string, count:number, bifolia:number, leaves:{folio:string, conjoin:number|null}[]}} quire
 * @param {{x:number, y:number}} [at] position when nested in a larger SVG (export)
 */
export function quireSvg(quire, at = null) {
  const b = quire.bifolia;
  const { xRight, width, height } = quireSize(quire);
  const y = (i) => TOP + i * PITCH + PITCH / 2;

  const paths = [];
  for (let i = 0; i < b; i++) {
    const j = quire.leaves[i].conjoin;
    const yi = y(i);
    const yj = y(j);
    const ry = (yj - yi) / 2;
    const rx = Math.min(ry, MAX_RX);
    const xk = X0 + i * STEP + rx;
    paths.push(`<path class="cd-leaf" d="M${xRight} ${r1(yi)}H${r1(xk)}A${r1(rx)} ${r1(ry)} 0 0 0 ${r1(xk)} ${r1(yj)}H${xRight}"/>`);
  }
  const xSingle = X0 + b * STEP + 4;
  quire.leaves.forEach((leaf, i) => {
    if (leaf.conjoin !== null) return;
    const yi = y(i);
    paths.push(`<path class="cd-single" d="M${xRight} ${r1(yi)}H${r1(xSingle)}q-5 0 -5 5"/>`);
  });

  const labels = quire.leaves
    .map((leaf, i) => leaf.folio
      ? `<text class="cd-folio" x="${xRight + 6}" y="${r1(y(i))}" dominant-baseline="central">${escapeHtml(leaf.folio)}</text>`
      : "")
    .join("");

  const title = escapeHtml(quireSummary(quire));
  const pos = at ? ` x="${r1(at.x)}" y="${r1(at.y)}"` : "";
  return `<svg class="cd-quire" xmlns="http://www.w3.org/2000/svg" role="img"${pos} width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<title>${title}</title>` +
    `<rect class="cd-band" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="4"/>` +
    `<text class="cd-label" x="8" y="19">${escapeHtml(quire.label)}</text>` +
    `<text class="cd-count" x="${width - 8}" y="19" text-anchor="end">${quire.count}</text>` +
    paths.join("") + labels +
    `</svg>`;
}
