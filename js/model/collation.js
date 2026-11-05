// Collation formulas (the Gatherings column) → a quire/leaf model for the
// collation diagram (render/collation-svg.js).
//
// NordicLaw writes formulas as a "Roman quire list":
//
//   I:8 (4b, ff. 1-8); II:9 (4b, 1f, ff. 9-17); III:2 (1b; mirror-0:1)
//
// <quire>:<leaf count> (<n>b bifolia, <n>f single leaves, folio range, prose).
// The approach follows the Roman-list parser in Manuscripta's collation editor
// (editor-develop src/js/editor/collation/model/parseFormula.js), adapted to
// the looser NordicLaw data: quire headings are found anywhere outside
// parentheses (so prose prefixes, a "(…)" wrapper, and ",", ")" or no
// separator between quires all work), the composition is used to build the
// quire, and folio ranges may be non-arabic ("0:1-0:5", "*1-*11", "I-II",
// "a-g", "mirror-0:7").
//
// The formula does not say where single leaves sit, so they are drawn in the
// centre of the quire: the diagram is schematic. Prose is kept as notes and
// never turned into structure.

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

export function romanToInt(s) {
  const lower = String(s || "").toLowerCase();
  if (!lower || !/^[ivxlcdm]+$/.test(lower)) return null;
  let value = 0;
  for (let i = 0; i < lower.length; i++) {
    const digit = ROMAN[lower[i]];
    if (i + 1 < lower.length && ROMAN[lower[i + 1]] > digit) value -= digit;
    else value += digit;
  }
  return value || null;
}

function intToRoman(n, upper) {
  const table = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [v, r] of table) while (n >= v) { out += r; n -= v; }
  return upper ? out.toUpperCase() : out;
}

const OPEN = "([";
const CLOSE = ")]";

/** Index of the bracket that closes the one at `start`, or -1. */
function matchingClose(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (OPEN.includes(text[i])) depth++;
    else if (CLOSE.includes(text[i])) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Tidy a prose fragment for display; "" when it has no letters. */
function cleanProse(s) {
  const t = String(s || "")
    .replace(/\s+/g, " ")
    .replace(/(^|\s)\+(?=\s|$)/g, " ")
    .replace(/\s+([,;:])/g, "$1")
    .replace(/([,;])(?:\s*[,;])+/g, "$1")
    .replace(/:\s*[,;]/g, ":")
    .replace(/ {2,}/g, " ")
    .replace(/^[\s;,.:)\]]+|[\s;,(\[]+$/g, "")
    .trim();
  return /[A-Za-zÀ-ɏ]/.test(t) ? t : "";
}

/**
 * Leaf labels for a folio range. Arabic, roman, single-letter and
 * prefixed/suffixed numeric ranges ("0:1-0:5", "*1-*11", "1*-2*") are expanded
 * when they span exactly `count` leaves (or fewer: the rest stay unlabelled);
 * anything else labels only the first and last leaf.
 */
function rangeLabels(from, to, count) {
  const labels = new Array(count).fill("");
  if (!from) return { labels, span: null };
  if (to === undefined || to === null || to === "") {
    labels[0] = from;
    return { labels, span: 1 };
  }
  // seq = {at(i) → label, span}
  let seq = null;
  const make = (lo, hi, at) => (hi >= lo ? { at, span: hi - lo + 1 } : null);
  // "1"-"8", "0:1"-"0:5", "*1"-"*11", "1*"-"2*": shared prefix and suffix
  const a = /^(.*?)(\d+)(\D*)$/.exec(from);
  const b = /^(.*?)(\d+)(\D*)$/.exec(to);
  if (a && b && a[1] === b[1] && a[3] === b[3]) {
    const lo = parseInt(a[2], 10);
    seq = make(lo, parseInt(b[2], 10), (i) => `${a[1]}${lo + i}${a[3]}`);
  } else if (/^[a-z]$/.test(from) && /^[a-z]$/.test(to)) {
    const lo = from.charCodeAt(0);
    seq = make(lo, to.charCodeAt(0), (i) => String.fromCharCode(lo + i));
  } else if (/^(?:[IVXLCDM]+|[ivxlcdm]+)$/.test(from) && romanToInt(from) && romanToInt(to)) {
    const lo = romanToInt(from);
    const upper = from === from.toUpperCase();
    seq = make(lo, romanToInt(to), (i) => intToRoman(lo + i, upper));
  }
  if (seq && seq.span <= count) {
    for (let i = 0; i < seq.span; i++) labels[i] = seq.at(i);
    return { labels, span: seq.span };
  }
  if (seq && seq.span > count) {
    labels[0] = from;
    labels[count - 1] = to;
    return { labels, span: seq.span };
  }
  labels[0] = from;
  if (count > 1) labels[count - 1] = to;
  return { labels, span: null };
}

const FOLIO_TOKEN = "[*]?[\\w:]+[*]?";
const FOLIO_RANGE_RE = new RegExp(`\\bf{1,2}\\s*[.,]\\s*(${FOLIO_TOKEN})(?:\\s*[-–—]\\s*(${FOLIO_TOKEN}))?`, "i");
const BARE_RANGE_RE = new RegExp(`(?:^|[\\s;,(])(mirror|${FOLIO_TOKEN})\\s*[-–—]\\s*(mirror|${FOLIO_TOKEN})(?=$|[\\s;,)])`, "i");

/**
 * Read one quire from its heading and the text inside its parentheses.
 * @returns {{label:string, number:number|null, count:number, bifolia:number,
 *   singles:number, leaves:{folio:string, single:boolean, conjoin:number|null}[],
 *   note:string}|null}
 */
function readQuire(label, countText, body, warnings) {
  const name = `Quire ${label}`;
  // Bracketed comments may restate the structure ("[4b, ff. 1-8 from 9-16]"):
  // keep them as notes, out of the composition.
  const bracketNotes = [];
  let rest = String(body || "").replace(/\[([^\]]*)\]/g, (_m, inner) => {
    bracketNotes.push(inner.trim());
    return " ";
  });

  let bifolia = 0;
  let singles = 0;
  let sawComposition = false;
  rest = rest.replace(/(\d+)\s*b\b(?!\s*[-–])/gi, (_m, n) => {
    bifolia += parseInt(n, 10);
    sawComposition = true;
    return " ";
  });
  rest = rest.replace(/(\d+)\s*f(?![a-z]|\.\s*[\d*])\.?/gi, (_m, n) => {
    singles += parseInt(n, 10);
    sawComposition = true;
    return " ";
  });

  let count = countText ? parseInt(countText, 10) : null;
  if (!count && sawComposition) count = bifolia * 2 + singles;

  let from = null;
  let to = null;
  const fr = FOLIO_RANGE_RE.exec(rest);
  if (fr) {
    from = fr[1];
    to = fr[2] || null;
    rest = rest.replace(fr[0], " ");
  } else {
    const br = BARE_RANGE_RE.exec(rest);
    if (br) {
      from = br[1];
      to = br[2];
      rest = rest.replace(br[0], " ");
    }
  }

  if (!count) {
    warnings.push(`${name}: no leaf count; quire left out.`);
    return null;
  }

  if (sawComposition && bifolia * 2 + singles !== count) {
    warnings.push(`${name}: ${bifolia} bifolia and ${singles} single leaves make ` +
      `${bifolia * 2 + singles} leaves, but the quire has ${count}; drawn as ${count} nested leaves.`);
    bifolia = Math.floor(count / 2);
    singles = count - bifolia * 2;
  } else if (!sawComposition) {
    bifolia = Math.floor(count / 2);
    singles = count - bifolia * 2;
  }

  const { labels, span } = rangeLabels(from, to, count);
  if (span !== null && span !== count && to) {
    warnings.push(`${name}: folios ${from}-${to} span ${span} leaves, but the quire has ${count}.`);
  }

  // b nested bifolia around the f single leaves in the centre.
  const leaves = labels.map((folio, i) => {
    let conjoin = null;
    if (i < bifolia) conjoin = count - 1 - i;
    else if (i >= count - bifolia) conjoin = count - 1 - i;
    return { folio, single: conjoin === null, conjoin };
  });

  const note = [cleanProse(rest), ...bracketNotes.map(cleanProse)].filter(Boolean).join("; ");
  return {
    label,
    number: /^\d+$/.test(label) ? parseInt(label, 10) : romanToInt(label),
    count, bifolia, singles, leaves, note,
    folioRange: from ? (to ? `${from}-${to}` : from) : "",
  };
}

// <roman>:<count>, or the Swedish "0:<count>" quire before the first one.
const HEAD_RE = /(^|[^\w*:.\-–])([IVXLCDM]+|0)\s*:\s*(\d+)?\s*([(/])?/gi;
// a quire heading inside another quire's parentheses
const NEXT_HEAD_RE = /;\s*(?:[IVXLCDM]+|0)\s*:\s*\d+\s*\(/i;

/**
 * Parse a collation formula.
 * @returns {{quires:object[], notes:string[], warnings:string[], source:string}|null} null when
 *   no quire can be read (e.g. "Unknown", prose, arabic quire ranges)
 */
export function parseCollation(text) {
  let src = String(text || "").replace(/\s+/g, " ").trim();
  if (!src) return null;

  // A "(…)" wrapping the whole formula.
  if (src[0] === "(") {
    const close = matchingClose(src, 0);
    if (close === -1 || close >= src.replace(/[.\s]+$/, "").length - 1) {
      src = src.slice(1, close === -1 ? src.length : close).trim();
    }
  }

  const quires = [];
  const notes = [];
  const warnings = [];
  let pos = 0;
  let depth = 0;
  let depthAt = 0; // depth is tracked incrementally up to depthAt

  const advanceDepth = (to) => {
    for (; depthAt < to; depthAt++) {
      if (OPEN.includes(src[depthAt])) depth++;
      else if (CLOSE.includes(src[depthAt])) depth = Math.max(0, depth - 1);
    }
  };

  HEAD_RE.lastIndex = 0;
  let m;
  while ((m = HEAD_RE.exec(src)) !== null) {
    const headStart = m.index + m[1].length;
    advanceDepth(headStart);
    if (depth > 0) continue;
    const label = m[2].toUpperCase();
    const countText = m[3] || "";
    const opener = m[4] || "";
    // A heading needs a count or a parenthesised body.
    if (!countText && !opener) continue;

    const between = cleanProse(src.slice(pos, headStart));
    if (between) {
      if (/\d+\s*\(/.test(between)) warnings.push(`Could not read "${between.slice(0, 60)}".`);
      notes.push(between);
    }

    let end = HEAD_RE.lastIndex;
    let body = "";
    if (opener === "(") {
      const openIdx = end - 1;
      const close = matchingClose(src, openIdx);
      body = src.slice(openIdx + 1, close === -1 ? src.length : close);
      end = close === -1 ? src.length : close + 1;
      // An unclosed "(" runs into the next quire: "XIX:8 (4b, ff. 151-158; XX:8 (…"
      const next = NEXT_HEAD_RE.exec(body);
      if (next) {
        body = body.slice(0, next.index);
        end = openIdx + 1 + next.index;
      }
    } else if (opener === "/") {
      // "IX:14 /7b, ff. 96-109)": a typo for "("
      const close = src.indexOf(")", end);
      body = src.slice(end, close === -1 ? src.length : close);
      end = close === -1 ? src.length : close + 1;
    }
    const quire = readQuire(label, countText, body, warnings);
    if (quire) quires.push(quire);
    pos = end;
    depthAt = end;
    depth = 0;
    HEAD_RE.lastIndex = end;
  }
  const tail = cleanProse(src.slice(pos));
  if (tail) {
    if (/\d+\s*\(/.test(tail)) warnings.push(`Could not read "${tail.slice(0, 60)}".`);
    notes.push(tail);
  }

  if (!quires.length) return null;

  for (let i = 1; i < quires.length; i++) {
    const prev = quires[i - 1].number;
    const cur = quires[i].number;
    if (prev !== null && cur !== null && cur !== prev + 1 && !(prev === 0 && cur === 1)) {
      warnings.push(`Quire ${quires[i].label} follows quire ${quires[i - 1].label}.`);
    }
  }
  return { quires, notes, warnings, source: String(text).replace(/\s+/g, " ").trim() };
}

/** The collation of a segments-manuscript: its Gatherings segments in order. */
export function collationForManuscript(ms) {
  const segs = ms && ms.segmentsByColumn && Array.isArray(ms.segmentsByColumn.Gatherings)
    ? ms.segmentsByColumn.Gatherings : [];
  const labels = segs.map((s) => String((s && s.label) || "").trim()).filter(Boolean);
  if (!labels.length) return null;
  return parseCollation(labels.join("; "));
}
