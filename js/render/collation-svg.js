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

const K = 0.5523; // cubic Bézier approximation of a quarter ellipse

/**
 * Path segments of a fold: from `xRight` left to the fold at `xk`, a half
 * ellipse (radii rx, ry) down from yi to yj, and back right. Segments are
 * absolute ["M"|"L", x, y] / ["C", x1, y1, x2, y2, x, y], so the same shape
 * can be written to SVG and drawn into a PDF.
 */
export function foldPath(xRight, xk, yi, yj, rx) {
  const ry = (yj - yi) / 2;
  const cy = yi + ry;
  return [
    ["M", xRight, yi], ["L", xk, yi],
    ["C", xk - K * rx, yi, xk - rx, cy - K * ry, xk - rx, cy],
    ["C", xk - rx, cy + K * ry, xk - K * rx, yj, xk, yj],
    ["L", xRight, yj],
  ];
}

/** Path of a single leaf: from `xRight` left to `xs`, then a small hook down. */
export function hookPath(xRight, xs, y, r = 5) {
  return [["M", xRight, y], ["L", xs, y], ["C", xs - (2 * r) / 3, y, xs - r, y + r / 3, xs - r, y + r]];
}

const pathD = (segs) => segs.map(([c, ...n]) => c + n.map(r1).join(" ")).join("");

/**
 * A drawing as plain shapes: {t:"rect", cls, x, y, w, h, rx},
 * {t:"path", cls, segs}, {t:"text", cls, x, y, text, anchor?:"end", middle?},
 * {t:"group", cls, x?, y?, w, h, title, items} (nested coordinates).
 * `shapesSvg` writes them as SVG; the collation PDF export draws them with jsPDF.
 */
export function shapesSvg(items) {
  return items.map((it) => {
    switch (it.t) {
      case "rect":
        return `<rect class="${it.cls}" x="${r1(it.x)}" y="${r1(it.y)}" width="${r1(it.w)}" height="${r1(it.h)}" rx="${it.rx || 0}"/>`;
      case "path":
        return `<path class="${it.cls}" d="${pathD(it.segs)}"/>`;
      case "text":
        return `<text class="${it.cls}" x="${r1(it.x)}" y="${r1(it.y)}"` +
          (it.anchor === "end" ? ` text-anchor="end"` : "") +
          (it.middle ? ` dominant-baseline="central"` : "") +
          `>${escapeHtml(it.text)}</text>`;
      case "group": {
        const pos = it.x != null ? ` x="${r1(it.x)}" y="${r1(it.y)}"` : "";
        return `<svg class="${it.cls}" xmlns="http://www.w3.org/2000/svg" role="img"${pos} width="${it.w}" height="${it.h}" viewBox="0 0 ${it.w} ${it.h}">` +
          `<title>${escapeHtml(it.title)}</title>${shapesSvg(it.items)}</svg>`;
      }
      default:
        return "";
    }
  }).join("");
}

/**
 * One quire as a shape group (see `shapesSvg`).
 * @param {{label:string, count:number, bifolia:number, leaves:{folio:string, conjoin:number|null}[]}} quire
 * @param {{x:number, y:number}} [at] position when nested in a larger drawing (export)
 */
export function quireShapes(quire, at = null) {
  const b = quire.bifolia;
  const { xRight, width, height } = quireSize(quire);
  const y = (i) => TOP + i * PITCH + PITCH / 2;

  const items = [
    { t: "rect", cls: "cd-band", x: 0.5, y: 0.5, w: width - 1, h: height - 1, rx: 4 },
    { t: "text", cls: "cd-label", x: 8, y: 19, text: quire.label },
    { t: "text", cls: "cd-count", x: width - 8, y: 19, text: String(quire.count), anchor: "end" },
  ];
  for (let i = 0; i < b; i++) {
    const yi = y(i);
    const yj = y(quire.leaves[i].conjoin);
    const rx = Math.min((yj - yi) / 2, MAX_RX);
    items.push({ t: "path", cls: "cd-leaf", segs: foldPath(xRight, X0 + i * STEP + rx, yi, yj, rx) });
  }
  const xSingle = X0 + b * STEP + 4;
  quire.leaves.forEach((leaf, i) => {
    if (leaf.conjoin === null) items.push({ t: "path", cls: "cd-single", segs: hookPath(xRight, xSingle, y(i)) });
  });
  quire.leaves.forEach((leaf, i) => {
    if (leaf.folio) items.push({ t: "text", cls: "cd-folio", x: xRight + 6, y: y(i), text: leaf.folio, middle: true });
  });

  return { t: "group", cls: "cd-quire", ...(at || {}), w: width, h: height, title: quireSummary(quire), items };
}

/** One quire as an SVG string (`at` as in `quireShapes`). */
export function quireSvg(quire, at = null) {
  return shapesSvg([quireShapes(quire, at)]);
}
