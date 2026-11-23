// Readers Guide modal: static content in index.html, opened from the intro.
// Its contents links scroll within the modal; its links to the List of
// Abbreviations and the Bibliography open those modals over this one and
// return to it on close (modal-stack.js).

import { showModalOver } from "./modal-stack.js";
import { openBibliography } from "./bib-modal.js";

/** Wire the in-guide links. `abbrModal`: the List of Abbreviations modal. */
export function bindReadersGuideModal(modal, abbrModal) {
  if (!modal) return;
  modal.addEventListener("click", (e) => {
    const jump = e.target.closest("[data-guide-jump]");
    if (jump) {
      e.preventDefault();
      const target = modal.querySelector(`#${CSS.escape(jump.getAttribute("data-guide-jump"))}`);
      if (target) target.scrollIntoView({ block: "start" });
      return;
    }
    if (e.target.closest("[data-guide-abbr]")) {
      e.preventDefault();
      showModalOver(abbrModal, modal);
      return;
    }
    if (e.target.closest("[data-guide-bib]")) {
      e.preventDefault();
      openBibliography([], modal);
    }
  });
}
