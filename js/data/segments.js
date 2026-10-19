// Lazy loader for the per-manuscript *_segments.json files, indexed by manuscript
// key (Depository abbr || Shelfmark) so the details modal can look one up.

import { SOURCES } from "./manifest.js";
import { normalizeForCompare } from "../util/text.js";

const keyOf = (dep, shelf) =>
  (normalizeForCompare(dep) || "") + "||" + (normalizeForCompare(shelf) || "");

/**
 * @returns {Promise<{indexBySource: Map<string, Map<string, object>>, loaded: number}>}
 */
export async function loadSegments() {
  const indexBySource = new Map();
  let loaded = 0;

  await Promise.all(
    SOURCES.map(async (src) => {
      if (!src.segments) return;
      try {
        const resp = await fetch(src.segments);
        if (!resp.ok) throw new Error(`${src.segments}: ${resp.status}`);
        const root = await resp.json();
        const idx = new Map();
        for (const ms of Array.isArray(root.manuscripts) ? root.manuscripts : []) {
          if (!ms || typeof ms !== "object") continue;
          const k = keyOf(ms.Depository, ms.Shelfmark);
          if (k !== "||") idx.set(k, ms);
        }
        indexBySource.set(src.id, idx);
        loaded += 1;
      } catch (e) {
        console.warn(`Segments unavailable for ${src.id}:`, e);
      }
    })
  );

  return { indexBySource, loaded };
}
