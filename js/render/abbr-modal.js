// List of Abbreviations modal, built from the lookup tables:
// depositories.tsv, texts.tsv (main texts with their sections) and abbreviations.tsv.

import { escapeHtml } from "../util/text.js";
import { loadDepositoryMap, loadAbbreviationsMap, loadTextsRows } from "../data/lookups.js";

/**
 * Group texts.tsv rows by main text, in file order: [{ abbr, full, sections }].
 * A section whose main text has no row of its own still gets a group (full "").
 */
export function groupTexts(rows) {
  const byMain = new Map();
  const group = (abbr) => {
    if (!byMain.has(abbr)) byMain.set(abbr, { abbr, full: "", sections: [] });
    return byMain.get(abbr);
  };
  for (const r of rows) {
    if (!r.section) group(r.main).full = r.full;
    else group(r.main).sections.push({ abbr: r.section, full: r.full });
  }
  return [...byMain.values()];
}

function pairsTable(entries) {
  const body = entries
    .map(([abbr, full]) => `<tr><th scope="row">${escapeHtml(abbr)}</th><td>${escapeHtml(full)}</td></tr>`)
    .join("");
  return `<table class="table table-sm abbr-table"><tbody>${body}</tbody></table>`;
}

/** Build the modal body. `depositories`/`general`: abbr -> full; `texts`: groupTexts output. */
export function buildAbbreviationsHtml({ depositories = {}, texts = [], general = {} }) {
  const textRows = texts
    .map((t) => {
      const head = `<tr><th scope="row">${escapeHtml(t.abbr)}</th><td>${escapeHtml(t.full)}</td></tr>`;
      const sections = t.sections
        .map(
          (s) =>
            `<tr class="abbr-section"><th scope="row">${escapeHtml(t.abbr)} ${escapeHtml(s.abbr)}</th>` +
            `<td>${escapeHtml(s.full)}</td></tr>`
        )
        .join("");
      return head + sections;
    })
    .join("");
  return [
    `<h6>Depositories</h6>`,
    pairsTable(Object.entries(depositories)),
    `<h6 class="mt-4">Texts</h6>`,
    `<table class="table table-sm abbr-table"><tbody>${textRows}</tbody></table>`,
    `<h6 class="mt-4">Other abbreviations</h6>`,
    pairsTable(Object.entries(general)),
  ].join("");
}

/** Fill the modal body the first time the modal opens. */
export function bindAbbreviationsModal(modal) {
  const body = modal?.querySelector(".modal-body");
  if (!body) return;
  let filled = false;
  modal.addEventListener("show.bs.modal", async () => {
    if (filled) return;
    filled = true;
    const [depositories, general, rows] = await Promise.all([
      loadDepositoryMap(),
      loadAbbreviationsMap(),
      loadTextsRows(),
    ]);
    body.innerHTML = buildAbbreviationsHtml({ depositories, texts: groupTexts(rows), general });
  });
}
