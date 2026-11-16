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

/**
 * Start folio of a Leaves/Pages value: "f.76r", "ff. 1r–123v", "Ff. 116v14-117r12"
 * -> "76r", "1r", "116v"; "ff. 12-20" -> "12" (its recto, see canvasIdForLocus).
 * Null for anything else (page references, starred folios, bare numbers).
 */
export function startFolio(value) {
  const m = String(value || "").match(/^\s*(?:ff?|fol)\.?\s*(\d+)\s*([rv])?/i);
  return m ? `${Number(m[1])}${(m[2] || "").toLowerCase()}` : null;
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
