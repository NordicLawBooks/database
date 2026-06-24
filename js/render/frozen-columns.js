// Sticky-left "frozen" columns (Depository + Shelf mark). Ported from the legacy
// implementation; layout-measurement heavy and finicky, so kept faithful.
// Bootstrap's translucent table striping is blended to an opaque colour so the
// frozen cells don't show rows scrolling underneath.

export const FROZEN_COLUMNS = ["Depository", "Shelf mark"];

const RGBA_RE = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/;
const rgbaCache = new Map();

function parseCssRgba(color) {
  if (color == null) return null;
  const s = String(color).trim().toLowerCase();
  if (!s) return null;
  if (rgbaCache.has(s)) return rgbaCache.get(s);
  if (s === "transparent") {
    const out = { r: 0, g: 0, b: 0, a: 0 };
    rgbaCache.set(s, out);
    return out;
  }
  const m = s.match(RGBA_RE);
  if (!m) return null;
  const out = {
    r: Math.max(0, Math.min(255, Math.round(Number(m[1])))),
    g: Math.max(0, Math.min(255, Math.round(Number(m[2])))),
    b: Math.max(0, Math.min(255, Math.round(Number(m[3])))),
    a: m[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(m[4]))),
  };
  rgbaCache.set(s, out);
  return out;
}

function blendOver(fg, bg) {
  if (!fg) return bg;
  if (!bg) bg = { r: 255, g: 255, b: 255, a: 1 };
  const a = typeof fg.a === "number" ? fg.a : 1;
  const inv = 1 - a;
  return {
    r: Math.round(fg.r * a + bg.r * inv),
    g: Math.round(fg.g * a + bg.g * inv),
    b: Math.round(fg.b * a + bg.b * inv),
    a: 1,
  };
}

function opaqueBackground(el, baseBg) {
  if (!el) return "rgb(255, 255, 255)";
  let fg = parseCssRgba(getComputedStyle(el).backgroundColor);
  if (fg && fg.a === 0) {
    const tr = el.closest ? el.closest("tr") : null;
    if (tr) {
      const trBg = parseCssRgba(getComputedStyle(tr).backgroundColor);
      if (trBg && trBg.a > 0) fg = trBg;
    }
  }
  if (!fg) return "rgb(255, 255, 255)";
  if (fg.a >= 1) return `rgb(${fg.r}, ${fg.g}, ${fg.b})`;
  const out = blendOver(fg, baseBg);
  return `rgb(${out.r}, ${out.g}, ${out.b})`;
}

const cssEscape =
  typeof CSS !== "undefined" && CSS && typeof CSS.escape === "function"
    ? CSS.escape
    : (s) => String(s).replace(/[^A-Za-z0-9_-]/g, (ch) => `\\${ch}`);

/** Apply sticky-left positioning + opaque backgrounds to the frozen columns. */
export function applyFrozenColumnsToTable(tableEl, fields = FROZEN_COLUMNS) {
  if (!tableEl || !(tableEl instanceof Element)) return;
  const headRow = tableEl.querySelector("thead tr");
  if (!headRow) return;

  const headCells = Array.from(headRow.querySelectorAll("th"));
  const indexByField = new Map();
  headCells.forEach((th, i) => {
    const f = th.getAttribute("data-field");
    if (f) indexByField.set(f, i);
  });

  const present = (Array.isArray(fields) ? fields : []).filter((f) => indexByField.has(f));
  if (present.length === 0) return;

  let baseBg = parseCssRgba(getComputedStyle(tableEl).backgroundColor);
  if (!baseBg || baseBg.a === 0) baseBg = parseCssRgba(getComputedStyle(document.body).backgroundColor);
  if (!baseBg || baseBg.a === 0) baseBg = { r: 255, g: 255, b: 255, a: 1 };

  for (const th of headCells) {
    th.classList.remove("frozen-col", "frozen-col-edge", "frozen-col-first");
    th.style.left = "";
    th.style.backgroundColor = "";
  }
  for (const el of tableEl.querySelectorAll("tbody td.frozen-col")) {
    el.classList.remove("frozen-col", "frozen-col-edge", "frozen-col-first");
    el.style.left = "";
    el.style.backgroundColor = "";
  }

  let left = 0;
  for (let i = 0; i < present.length; i++) {
    const field = present[i];
    const th = headCells[indexByField.get(field)];
    if (!th) continue;
    const isFirst = i === 0;
    const isEdge = i === present.length - 1;

    th.classList.add("frozen-col");
    if (isFirst) th.classList.add("frozen-col-first");
    if (isEdge) th.classList.add("frozen-col-edge");
    th.style.left = `${Math.round(left)}px`;
    th.style.backgroundColor = opaqueBackground(th, baseBg);

    for (const td of tableEl.querySelectorAll(`tbody td[data-field="${cssEscape(field)}"]`)) {
      td.classList.add("frozen-col");
      if (isFirst) td.classList.add("frozen-col-first");
      if (isEdge) td.classList.add("frozen-col-edge");
      td.style.left = `${Math.round(left)}px`;
      td.style.backgroundColor = opaqueBackground(td, baseBg);
    }

    const w = th.getBoundingClientRect().width;
    left += Number.isFinite(w) ? Math.round(w) : th.offsetWidth || 0;
  }
}
