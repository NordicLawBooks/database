// Bibliography modal: the Zotero group's entries (js/model/bibliography.js),
// opened from the intro and from citations in Literature cells (literatureHtml),
// which scroll to and highlight the entries they cite. From a details modal it
// opens over that modal and returns to it on close (modal-stack.js), unless the
// image viewer was opened from an entry.

import { escapeHtml } from "../util/text.js";
import { bibliographyEntries } from "../model/bibliography.js";
import { showModalOver } from "./modal-stack.js";

export const ZOTERO_GROUP_URL = "https://www.zotero.org/groups/6768725/nordiclaw";

function externalLink(href, label) {
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

/** One entry: the formatted reference, then its Zotero / online / image links. */
export function bibEntryHtml(e) {
  const links = [];
  if (e.zotero) links.push(externalLink(e.zotero, "Zotero"));
  if (e.url) links.push(externalLink(e.url, "Online"));
  for (const m of e.iiif || []) {
    const href = `${m}?manifest=${encodeURIComponent(m)}`;
    links.push(
      `<a href="${escapeHtml(href)}" class="iiif-open" data-iiif-manifest="${escapeHtml(m)}" title="View images (IIIF)">` +
        `View images <img src="img/iiif.svg" alt="" width="23" height="12"></a>`
    );
  }
  // e.html was sanitised by fetch_zotero.py (text plus <i>, <b>, <sup>, <sub>).
  return `<li id="bib-${escapeHtml(e.key)}" class="bib-entry" data-bib-key="${escapeHtml(e.key)}">` +
    `<div>${e.html}</div>${links.length ? `<div class="small bib-links">${links.join(" · ")}</div>` : ""}</li>`;
}

export function buildBibliographyHtml(entries) {
  const source = `the NordicLaw ${externalLink(ZOTERO_GROUP_URL, "Zotero group library")}`;
  if (!entries.length) return `<p class="small text-secondary">No works yet. The bibliography is kept in ${source}.</p>`;
  return `<p class="small text-secondary">${entries.length} works, from ${source}.</p>` + `<ul class="list-unstyled bib-list">${entries.map(bibEntryHtml).join("")}</ul>`;
}

let modalEl = null;
let filledWith = null;

function fill() {
  const entries = bibliographyEntries();
  if (filledWith === entries) return;
  filledWith = entries;
  modalEl.querySelector(".modal-body").innerHTML = buildBibliographyHtml(entries);
}

/** Fill the modal when it opens (the intro link opens it via data-bs-toggle). */
export function bindBibliographyModal(modal) {
  if (!modal) return;
  modalEl = modal;
  modal.addEventListener("show.bs.modal", fill);
  modal.addEventListener("hidden.bs.modal", () => {
    for (const li of modal.querySelectorAll(".bib-entry.bib-highlight")) li.classList.remove("bib-highlight");
  });
}

/** Open the bibliography at the entries `keys` (highlighted), over `returnTo` if given. */
export function openBibliography(keys = [], returnTo = null) {
  if (!modalEl) return;
  fill();
  const targets = keys.map((k) => modalEl.querySelector(`#bib-${CSS.escape(k)}`)).filter(Boolean);
  for (const li of targets) li.classList.add("bib-highlight");
  if (targets.length) {
    modalEl.addEventListener("shown.bs.modal", () => targets[0].scrollIntoView({ block: "center", behavior: "instant" }), { once: true });
  }
  let openedImages = false;
  const onImages = (e) => { if (e.target.closest("[data-iiif-manifest]")) openedImages = true; };
  modalEl.addEventListener("click", onImages);
  modalEl.addEventListener("hidden.bs.modal", () => modalEl.removeEventListener("click", onImages), { once: true });
  showModalOver(modalEl, returnTo, { shouldReturn: () => !openedImages });
}
