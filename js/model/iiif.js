// IIIF manifests behind "Links to Database" links, for the image viewer
// (js/render/iiif-modal.js). data/iiif_manifests.json (built by
// data/scripts/build_iiif_index.py) lists the links whose manifest exists; it
// decides where the viewer is offered, not the "(not digitised)" link labels.
// The index is registered once at startup (setIiifIndex) so the shared link
// renderer can look links up without threading it through every view.

/** Link pattern -> index key. Keep in sync with PROVIDERS in build_iiif_index.py. */
const IIIF_SOURCES = [
  { prefix: "ms", re: /^https?:\/\/(?:www\.)?manuscripta\.se\/ms\/(\d+)/i },
  { prefix: "nb", re: /^https?:\/\/(?:www\.)?nb\.no\/items\/([0-9a-f]{32})/i },
];
const URL_RE = /https?:\/\/[^\s;()[\]]+/g;

let index = {};

/** Register the parsed iiif_manifests.json ({ key: { manifest, canvases } }). */
export function setIiifIndex(idx) {
  index = idx && typeof idx === "object" ? idx : {};
}

/** Index key ("ms:100255", "nb:<id>") for a link URL, or null. */
export function iiifKeyForUrl(url) {
  const s = String(url || "").trim();
  for (const { prefix, re } of IIIF_SOURCES) {
    const m = s.match(re);
    if (m) return `${prefix}:${m[1].toLowerCase()}`;
  }
  return null;
}

/** { key, manifest, canvases } for a link URL with an indexed manifest, else null. */
export function iiifEntryForUrl(url) {
  const key = iiifKeyForUrl(url);
  const hit = key && Object.prototype.hasOwnProperty.call(index, key) ? index[key] : null;
  return hit && hit.manifest ? { key, manifest: hit.manifest, canvases: hit.canvases || 0 } : null;
}

/** Indexed manifests for every link in a Links to Database value, de-duplicated, in order. */
export function manifestsForLinks(value) {
  const out = [];
  const seen = new Set();
  for (const url of String(value || "").match(URL_RE) || []) {
    const e = iiifEntryForUrl(url);
    if (e && !seen.has(e.key)) {
      seen.add(e.key);
      out.push(e);
    }
  }
  return out;
}

/** Plain-text label of a canvas: Presentation 2 (string / array / {@value}) or 3 (language map). */
export function canvasLabel(canvas) {
  const pick = (v) => {
    if (v == null) return "";
    if (typeof v === "string" || typeof v === "number") return String(v);
    if (Array.isArray(v)) return v.length ? pick(v[0]) : "";
    if (typeof v === "object") {
      if ("@value" in v) return pick(v["@value"]);
      const vals = Object.values(v);
      return vals.length ? pick(vals[0]) : "";
    }
    return "";
  };
  return pick(canvas && canvas.label).trim();
}

/** "f. 12r", "fol. 12 r", "12r" -> "12r"; null when the label isn't a folio. */
export function folioOf(label) {
  const m = String(label || "").toLowerCase().match(/^\s*(?:ff?|fol|folio)?\.?\s*(\d+)\s*([rv])\s*$/);
  return m ? `${Number(m[1])}${m[2]}` : null;
}

// A folio reference: leaf number with optional side, column and line ("151r29",
// "1ra", "12"), or a side alone, which takes the previous leaf ("r-v", "ra–rb").
// Not inside a word (so "marg." or "lower" don't count), not starred ("*3r").
const FOLIO_TOKEN_RE = /(?<![\p{L}\d*])(?:(\d+)\s*([rv])?([ab])?(?:(\d+)|:(\d+))?|([rv])([ab])?(\d+)?)(?![\p{L}\d])/giu;

/**
 * Split a Leaves/Pages value into text and folio pieces:
 * "ff. 1r–17r" -> ["ff. ", {1r}, "–", {17r}]; "f. 151r29-v16" -> 151r and 151v.
 * Each piece is { text, folio } with folio "151v" / "12" (a bare leaf: its recto)
 * or null. Only values starting with f./ff./fol. are tokenised; a bare number
 * after a reference with a line number is that line's end ("f. 151r1-28"); page
 * references ("ff. s. 21–84") and "0:7r" quire numbers stay text.
 */
export function leavesTokens(value) {
  const text = String(value == null ? "" : value);
  const prefix = text.match(/^\s*(?:ff?|fol)(?!\p{L})\.?\s*/iu);
  if (!prefix || /^s\./i.test(text.slice(prefix[0].length))) return text ? [{ text, folio: null }] : [];
  const out = [];
  const push = (t, folio) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (!folio && last && !last.folio) last.text += t;
    else out.push({ text: t, folio });
  };
  let pos = 0;
  let leaf = null; // the previous reference's leaf, for a side alone
  let hadLine = false;
  FOLIO_TOKEN_RE.lastIndex = prefix[0].length;
  for (let m; (m = FOLIO_TOKEN_RE.exec(text)); ) {
    const [tok, num, side, , line, colonLine, sideOnly, , sideLine] = m;
    push(text.slice(pos, m.index), null);
    pos = m.index + tok.length;
    let folio = null;
    if (num != null) {
      const between = text.slice(m.index - 3 < 0 ? 0 : m.index - 3, m.index);
      const isLineEnd = !side && !line && !colonLine && hadLine && /[-–]\s*$/.test(between);
      const isQuire = !side && text[pos] === ":";
      if (!isLineEnd && !isQuire) {
        leaf = Number(num);
        folio = `${leaf}${(side || "").toLowerCase()}`;
        hadLine = line != null || colonLine != null;
      }
    } else if (leaf != null) {
      folio = `${leaf}${sideOnly.toLowerCase()}`;
      hadLine = sideLine != null;
    }
    push(tok, folio);
  }
  push(text.slice(pos), null);
  return out;
}

function canvasesOf(manifest) {
  if (!manifest || typeof manifest !== "object") return [];
  if (Array.isArray(manifest.items)) return manifest.items.filter((c) => c && c.type === "Canvas");
  const seq = Array.isArray(manifest.sequences) ? manifest.sequences[0] : null;
  return seq && Array.isArray(seq.canvases) ? seq.canvases : [];
}

/**
 * Canvas id for a segment locus ({ kind: "f", from: "12r" | "12v" | "12" }) in a
 * manifest, matched by the canvas's folio label; a bare leaf number means its
 * recto. Null when nothing matches (the viewer then opens at the start).
 */
export function canvasIdForLocus(manifest, locus) {
  if (!locus || locus.kind !== "f" || locus.from == null) return null;
  const m = String(locus.from).trim().toLowerCase().match(/^(\d+)\s*([rv])?$/);
  if (!m) return null;
  const target = `${Number(m[1])}${m[2] || "r"}`;
  for (const c of canvasesOf(manifest)) {
    if (folioOf(canvasLabel(c)) === target) return c["@id"] || c.id || null;
  }
  return null;
}
