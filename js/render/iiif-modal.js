// Image viewer modal (#iiifModal): Mirador on a IIIF manifest, full screen.
// The fallback for narrow screens, where the viewer pane (iiif-pane.js) has no
// room. A fresh viewer is mounted per open and unmounted on close.

import { escapeHtml } from "../util/text.js";
import { getMirador, canvasForLocus, windowConfig, MIRADOR_THEME } from "./mirador.js";
import { showModalOver } from "./modal-stack.js";

const VIEWER_ID = "iiif-viewer";

let viewer = null;
let openSeq = 0;
let bound = false;

function bindOnce(modalEl) {
  if (bound) return;
  bound = true;
  modalEl.addEventListener("hidden.bs.modal", () => {
    openSeq++; // cancels a viewer still loading
    if (viewer) {
      try { viewer.unmount(); } catch (e) { console.error(e); }
      viewer = null;
    }
    const host = modalEl.querySelector(".iiif-host");
    if (host) host.innerHTML = "";
  });
}

function whenShown(modalEl) {
  if (modalEl.classList.contains("show")) return Promise.resolve();
  return new Promise((resolve) => modalEl.addEventListener("shown.bs.modal", () => resolve(), { once: true }));
}

/**
 * Open the viewer on `manifest`, at the canvas for `locus` (a segment locus,
 * see canvasIdForLocus) when given. `returnTo`: an open modal to hide while
 * the viewer is open and show again afterwards.
 * @param {{manifest:string, title?:string, locus?:object}} target
 */
export async function openIiifModal({ manifest, title = "", locus = null }, returnTo = null) {
  const modalEl = document.getElementById("iiifModal");
  if (!modalEl || !manifest) return;
  bindOnce(modalEl);
  const seq = ++openSeq;
  const titleEl = document.getElementById("iiifModalLabel");
  if (titleEl) titleEl.textContent = title ? `Images — ${title}` : "Images";
  const sourceLink = document.getElementById("iiif-manifest-link");
  if (sourceLink) sourceLink.href = manifest;
  const host = modalEl.querySelector(".iiif-host");
  host.innerHTML = '<div class="iiif-status text-secondary p-3">Loading viewer…</div>';
  showModalOver(modalEl, returnTo);

  let Mirador;
  let canvasId = null;
  try {
    [Mirador, canvasId] = await Promise.all([
      getMirador(),
      canvasForLocus(manifest, locus),
      whenShown(modalEl),
    ]);
  } catch (e) {
    console.error(e);
    if (seq === openSeq) {
      host.innerHTML = `<div class="iiif-status text-danger p-3">Could not load the image viewer (${escapeHtml(e.message)}).</div>`;
    }
    return;
  }
  if (seq !== openSeq) return; // closed (or reopened) while loading

  host.innerHTML = `<div id="${VIEWER_ID}"></div>`;
  viewer = Mirador.viewer({
    theme: MIRADOR_THEME,
    id: VIEWER_ID,
    windows: [windowConfig(manifest, canvasId)],
    window: {
      allowClose: false,
      allowMaximize: false,
      allowFullscreen: true,
      sideBarOpen: false,
      defaultView: "single",
    },
    workspace: { showZoomControls: true },
    workspaceControlPanel: { enabled: false },
  });
}
