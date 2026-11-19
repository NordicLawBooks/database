// Shared Mirador plumbing for the image viewer pane (iiif-pane.js) and the
// full-screen fallback modal (iiif-modal.js). Mirador (~2 MB) is only needed on
// a rare click, so its UMD bundle is loaded from the CDN the first time; the
// global exposes `viewer()` plus the action creators (addWindow, setCanvas, …).

import { canvasIdForLocus } from "../model/iiif.js";

const MIRADOR_SRC = "https://cdn.jsdelivr.net/npm/mirador@4.3.0/dist/mirador.min.js";

let miradorPromise = null;

/** The Mirador global, loading the bundle on first use. */
export function getMirador() {
  if (window.Mirador) return Promise.resolve(window.Mirador);
  if (!miradorPromise) {
    miradorPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = MIRADOR_SRC;
      s.async = true;
      s.onload = () => (window.Mirador ? resolve(window.Mirador) : reject(new Error("Mirador did not load")));
      s.onerror = () => reject(new Error("Failed to load Mirador"));
      document.head.appendChild(s);
    }).catch((e) => {
      miradorPromise = null; // allow a retry on the next click
      throw e;
    });
  }
  return miradorPromise;
}

// Manifests fetched to find a locus's canvas (Mirador fetches them again; the
// browser cache usually serves that).
const manifestCache = new Map();
function fetchManifest(url) {
  if (!manifestCache.has(url)) {
    const p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => manifestCache.delete(url));
    manifestCache.set(url, p);
  }
  return manifestCache.get(url);
}

/** Canvas id for a segment locus in `manifest` (see canvasIdForLocus); null if none or on error. */
export async function canvasForLocus(manifest, locus) {
  if (!locus) return null;
  try {
    return canvasIdForLocus(await fetchManifest(manifest), locus);
  } catch {
    return null;
  }
}

/**
 * A Mirador window config for `manifest`, opened at `canvasId` when given:
 * single-page view (overriding a manifest's "paged" hint), thumbnails off.
 */
export function windowConfig(manifest, canvasId = null) {
  const win = { manifestId: manifest, view: "single", thumbnailNavigationPosition: "off" };
  if (canvasId) win.canvasId = canvasId;
  return win;
}

// NorS (sprogsamlinger.ku.dk) serves plain JPEGs without a IIIF image service:
// the full image (2-3.5 MB) and, with a "thumb" parameter, a copy at 1/8 of its
// size (rounded up). Offered to OpenSeadragon as a two-level pyramid, the small
// copy is shown at fit and the full image is only fetched when zooming needs it.
const NORS_IMAGE_RE = /^https:\/\/sprogsamlinger\.ku\.dk\/projects\/sprogsamlinger\/ds-img\.php\?path=/;

/** A legacy-image-pyramid tile source for a NorS full-size image of `width` x `height`, else null. */
export function norsPyramid(url, width, height) {
  if (!NORS_IMAGE_RE.test(String(url || "")) || !(width > 0) || !(height > 0)) return null;
  const w = Math.round(width);
  const h = Math.round(height);
  return {
    type: "legacy-image-pyramid",
    levels: [
      { url: url.replace("ds-img.php?", "ds-img.php?thumb=200x200&"), width: Math.ceil(w / 8), height: Math.ceil(h / 8) },
      { url, width: w, height: h },
    ],
  };
}

// Mirador hands each image to OpenSeadragon as addTiledImage({ tileSource: { type:
// "image", url }, fitBounds }) and copies osdConfig onto the OpenSeadragon viewer,
// so this replaces the method on that instance only. fitBounds is the canvas,
// whose size is the image's in our NorS manifests.
function addTiledImage(options) {
  const ts = options && options.tileSource;
  const fb = options && options.fitBounds;
  const pyramid = ts && ts.type === "image" && fb ? norsPyramid(ts.url, fb.width, fb.height) : null;
  return Object.getPrototypeOf(this).addTiledImage.call(this, pyramid ? { ...options, tileSource: pyramid } : options);
}

/** OpenSeadragon options shared by the pane and the modal. */
export const MIRADOR_OSD_CONFIG = { addTiledImage };

// Mirador 4's default theme font sizes (rem), scaled down so its text is about
// the size of the results tables (0.88rem). Only fontSize is overridden; Mirador
// merges the rest of each variant from its defaults.
const MIRADOR_FONT_SIZES = {
  body1: 1, body2: 0.878, button: 0.878, caption: 0.772,
  body1Next: 1, body2Next: 0.878, buttonNext: 0.878, captionNext: 0.772, overline: 0.678,
  h1: 2.822, h2: 1.575, h3: 1.383, h4: 1.215, h5: 1.138, h6: 1.067, subtitle1: 0.937, subtitle2: 0.878,
};
const FONT_SCALE = 0.85;

/** Theme overrides shared by the pane and the modal. */
export const MIRADOR_THEME = {
  typography: Object.fromEntries(
    Object.entries(MIRADOR_FONT_SIZES).map(([k, rem]) => [k, { fontSize: `${(rem * FONT_SCALE).toFixed(3)}rem` }])
  ),
};
