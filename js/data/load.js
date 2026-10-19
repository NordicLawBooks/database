// Dataset loading for the browser: the raw per-language TSVs (blank cells
// preserved) + their merge geometry, assembled into the filtering model.

import { SOURCES } from "./manifest.js";
import { loadDepositoryMap } from "./lookups.js";
import { buildModel, enrichRow } from "../model/manuscript.js";
import { normalizeLeavesPages, normalizeGatherings, normalizeScribe } from "../model/fields.js";
import { normalizeForCompare } from "../util/text.js";
import { applyMergeAwareFillDown } from "../render/merge-geometry.js";

/**
 * Load the raw per-language TSVs (blank cells preserved) + their merge geometry,
 * for Manuscript View's merged-cell rendering. Rows are grouped by the filled-down
 * `__msKey` (Depository abbr + Shelf mark).
 *
 * @returns {Promise<{rawByKey: Map<string,{rows,sourceId}>, mergesBySource: Map<string,object>, loaded: number}>}
 */
export async function loadRawSources() {
  const depositoryMap = await loadDepositoryMap();
  const rawByKey = new Map();
  const mergesBySource = new Map();
  let headers = null;
  let loaded = 0;

  await Promise.all(
    SOURCES.map(async (src) => {
      let tsvText;
      try {
        const resp = await fetch(src.tsv);
        if (!resp.ok) throw new Error(`${src.tsv}: ${resp.status}`);
        tsvText = await resp.text();
      } catch (e) {
        console.warn(`Raw TSV unavailable for ${src.id}:`, e);
        return;
      }

      try {
        const mResp = await fetch(src.merges);
        if (mResp.ok) mergesBySource.set(src.id, await mResp.json());
        else console.warn(`Missing merge JSON for ${src.id}: ${src.merges} (${mResp.status})`);
      } catch (e) {
        console.warn(`Merge JSON unavailable for ${src.id}:`, e);
      }

      const lines = tsvText.split(/\r?\n/);
      if (!lines.length) return;
      const rawHeaders = (lines[0] || "").split("\t");
      const shelfIdx = rawHeaders.indexOf("Shelf mark");
      const injectLang = shelfIdx !== -1 && !rawHeaders.includes("Language");
      const srcHeaders = rawHeaders.slice();
      if (injectLang) srcHeaders.splice(shelfIdx + 1, 0, "Language");
      if (!headers) headers = srcHeaders;

      let currentShelf = "";
      let currentDepAbbr = "";

      for (let i = 1; i < lines.length; i++) {
        // Keep blank lines: __sourceRowIndex must align with the merges JSON.
        const values = (lines[i] !== undefined ? lines[i].split("\t") : []).slice();
        if (injectLang) values.splice(shelfIdx + 1, 0, src.lang);

        const obj = {};
        srcHeaders.forEach((h, c) => {
          let val = values[c] !== undefined ? values[c] : "";
          if (h === "Main text") val = String(val || "").trim();
          if (h === "Depository") {
            obj["Depository_abbr"] = val;
            if (val in depositoryMap) val = depositoryMap[val];
          }
          obj[h] = val;
        });

        // Hidden key fill (does NOT change the visible blank cells).
        const shelfVal = normalizeForCompare(obj["Shelf mark"]);
        const depAbbrVal = normalizeForCompare(obj["Depository_abbr"]);
        if (shelfVal) currentShelf = shelfVal;
        if (depAbbrVal) currentDepAbbr = depAbbrVal;
        obj["Depository_abbr"] = obj["Depository_abbr"] || currentDepAbbr;
        obj["__msKey"] = (currentDepAbbr || "") + "||" + (currentShelf || "");
        obj["__sourceId"] = src.id;
        obj["__sourceRowIndex"] = i - 1;
        enrichRow(obj);

        const msKey = obj["__msKey"];
        if (!msKey || msKey === "||") continue;
        if (!rawByKey.has(msKey)) rawByKey.set(msKey, { rows: [], sourceId: src.id });
        rawByKey.get(msKey).rows.push(obj);
      }

      loaded += 1;
    })
  );

  return { rawByKey, mergesBySource, headers, loaded };
}

// ---------------------------------------------------------------------------
// Raw-first model assembly (mirrors the legacy filled-TSV pipeline)
// ---------------------------------------------------------------------------

const MD_LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;
const EMPTY_IGNORE = new Set(["Century", "DatingYear", "DatingMinYear", "DatingMaxYear", "Main text group", "Depository_abbr", "Language"]);
const DEDUP_IGNORE = new Set(["Century", "DatingYear", "DatingMinYear", "DatingMaxYear", "Main text group", "Depository_abbr"]);

function dropCompletelyEmptyRows(rows, headers) {
  return rows.filter((r) => headers.some((h) => !EMPTY_IGNORE.has(h) && normalizeForCompare(r[h])));
}

function deduplicateRows(rows, headers) {
  const cols = headers.filter((h) => !DEDUP_IGNORE.has(h));
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = cols.map((h) => normalizeForCompare(r[h] ?? "")).join("");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Aggregate "Links to Database" per manuscript (drop bare labels of linked entries, dedupe). */
function mergeLinksPerManuscript(rows) {
  const byKey = new Map();
  const labelsWithUrls = new Map();
  const keyOf = (r) => `${normalizeForCompare(r["Depository_abbr"] || "")}||${normalizeForCompare(r["Shelf mark"] || "")}`;

  for (const r of rows) {
    const v = normalizeForCompare(r["Links to Database"]);
    if (!v) continue;
    const key = keyOf(r);
    const parts = v.split(";").map((p) => p.trim()).filter(Boolean);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(...parts);
    for (const p of parts) {
      const m = p.match(MD_LINK_RE);
      if (m) {
        if (!labelsWithUrls.has(key)) labelsWithUrls.set(key, new Set());
        labelsWithUrls.get(key).add(m[1]);
      }
    }
  }

  const merged = new Map();
  for (const [key, parts] of byKey.entries()) {
    const drop = labelsWithUrls.get(key) || new Set();
    const seen = new Set();
    const out = [];
    for (const p of parts) {
      if (!p || drop.has(p) || seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    merged.set(key, out.join("; "));
  }

  for (const r of rows) {
    const key = keyOf(r);
    if (merged.has(key)) r["Links to Database"] = merged.get(key);
  }
}

/**
 * Load the filtering model from the raw per-language sources, so its keys align
 * with Manuscript View's merge data. Throws if no source could be loaded.
 * The returned model carries `rawByKey` + `mergesBySource` for merged rendering.
 */
export async function loadModel() {
  const raw = await loadRawSources();
  if (!raw.loaded) throw new Error("No data sources could be loaded (see warnings above).");

  const headers = raw.headers;
  const filled = [];
  for (const [, block] of raw.rawByKey) {
    // Clone (drop internal keys but keep __sourceRowIndex for fill-down).
    const clone = block.rows.map((r) => {
      const o = {};
      for (const k of Object.keys(r)) if (!k.startsWith("__")) o[k] = r[k];
      o.__sourceRowIndex = r.__sourceRowIndex;
      return o;
    });
    applyMergeAwareFillDown(clone, raw.mergesBySource.get(block.sourceId));
    for (const r of clone) {
      delete r.__sourceRowIndex;
      for (const k of Object.keys(r)) if (r[k] === "Unavailable") r[k] = "";
      if ("Gatherings" in r) r["Gatherings"] = normalizeGatherings(r["Gatherings"]);
      if ("Scribe" in r) r["Scribe"] = normalizeScribe(r["Scribe"]);
      for (const h of headers) if (!(h in r)) r[h] = "";
      filled.push(r);
    }
  }

  let rows = dropCompletelyEmptyRows(filled, headers);
  mergeLinksPerManuscript(rows);
  rows = deduplicateRows(rows, headers);
  for (const r of rows) if ("Leaves/Pages" in r) r["Leaves/Pages"] = normalizeLeavesPages(r["Leaves/Pages"]);

  const model = buildModel(rows); // enriches (Main text group, Dating, language) + groups
  model.headers = headers;
  model.rawByKey = raw.rawByKey;
  model.mergesBySource = raw.mergesBySource;
  return model;
}
