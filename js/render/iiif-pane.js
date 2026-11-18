// Image viewer pane (#viewer-pane): Mirador beside the results, like the
// manuscripta.se search page. One viewer stays mounted while the pane is open;
// each manuscript opened becomes a Mirador window (so several can be compared),
// an already open one is focused (and moved to the locus's folio). Closing the
// last window, or the pane's close button, unmounts the viewer and hides the pane.
//
// The pane's width is a device pref (state.ui.viewerWidth). Whether it is open
// lives here, not in the store: Mirador's windows can't be restored anyway.
// The divider (#viewer-resizer) drags to resize; double-click / Enter / Space
// collapses and restores the pane; ←/→ resize by keyboard.

import { getMirador, canvasForLocus, windowConfig, MIRADOR_THEME, MIRADOR_OSD_CONFIG } from "./mirador.js";
import { setUi } from "./sidebar.js";

export const VIEWER_MIN = 320;
const RESULTS_MIN = 480; // keep this much room for the results
const KEY_STEP = 40;

/**
 * Clamp a pane width to `room` (the width the results and the pane share);
 * null/0 means the default, 45% of it.
 */
export function clampViewerWidth(w, room) {
  const max = Math.max(VIEWER_MIN, room - RESULTS_MIN);
  const want = Number(w) > 0 ? Number(w) : room * 0.45;
  return Math.round(Math.max(VIEWER_MIN, Math.min(max, want)));
}

/** Width shared by the results and the pane: the layout minus the facet sidebar and the dividers. */
function room() {
  const layout = document.getElementById("layout");
  const sidebar = document.getElementById("facet-sidebar");
  const sidebarW = sidebar && sidebar.offsetParent !== null ? sidebar.getBoundingClientRect().width + 16 : 0;
  return (layout ? layout.clientWidth : window.innerWidth) - sidebarW - 16;
}

/** True when the screen is too narrow for the pane (the modal is used instead). */
export function paneUnavailable() {
  return window.matchMedia("(max-width: 767.98px)").matches;
}

const VIEWER_ID = "iiif-pane-viewer";
let refs = null;
let viewer = null;
let unsubscribe = null;
let pending = Promise.resolve();

const body = () => document.body.classList;
const isOpen = () => body().contains("viewer-open");

function setCollapsed(collapsed) {
  body().toggle("viewer-collapsed", collapsed);
  if (refs.resizer) {
    refs.resizer.title = collapsed ? "Show the image viewer" : "Drag to resize the image viewer; double-click to hide it";
    refs.resizer.setAttribute("aria-expanded", String(!collapsed));
  }
}

/** Unmount the viewer and hide the pane. */
export function closeIiifPane() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  if (viewer) {
    try { viewer.unmount(); } catch (e) { console.error(e); }
    viewer = null;
  }
  if (refs && refs.host) refs.host.innerHTML = "";
  body().remove("viewer-open", "viewer-collapsed");
}

/**
 * Open `manifest` in the pane (at the canvas for `locus` when given): a new
 * Mirador window, or the existing one for that manifest, focused.
 * @param {{manifest:string, locus?:object}} target
 */
export function openInIiifPane({ manifest, locus = null }) {
  // Serialise opens so two quick clicks can't mount two viewers.
  pending = pending.then(() => doOpen(manifest, locus)).catch((e) => {
    console.error(e);
    if (refs.host && !viewer) refs.host.innerHTML = `<div class="text-danger p-3">Could not load the image viewer.</div>`;
  });
  return pending;
}

async function doOpen(manifest, locus) {
  if (!refs || !refs.host || !manifest) return;
  body().add("viewer-open");
  setCollapsed(false);
  if (!viewer) refs.host.innerHTML = '<div class="text-secondary p-3">Loading viewer…</div>';
  const [Mirador, canvasId] = await Promise.all([getMirador(), canvasForLocus(manifest, locus)]);
  if (!isOpen()) return; // closed while loading

  if (!viewer) {
    refs.host.innerHTML = `<div id="${VIEWER_ID}"></div>`;
    viewer = Mirador.viewer({
      theme: MIRADOR_THEME,
      osdConfig: MIRADOR_OSD_CONFIG,
      id: VIEWER_ID,
      windows: [windowConfig(manifest, canvasId)],
      window: { allowClose: true, allowMaximize: true, allowFullscreen: true, sideBarOpen: false, defaultView: "single" },
      workspace: { showZoomControls: true },
      workspaceControlPanel: { enabled: false },
    });
    // Closing the last Mirador window closes the pane.
    let hadWindows = false;
    unsubscribe = viewer.store.subscribe(() => {
      const n = Object.keys(viewer.store.getState().windows || {}).length;
      if (n > 0) hadWindows = true;
      else if (hadWindows) setTimeout(closeIiifPane, 0); // not during a dispatch
    });
    return;
  }

  const windows = Object.values(viewer.store.getState().windows || {});
  const existing = windows.find((w) => w.manifestId === manifest);
  if (existing) {
    viewer.store.dispatch(Mirador.focusWindow(existing.id, true));
    if (canvasId) viewer.store.dispatch(Mirador.setCanvas(existing.id, canvasId));
  } else {
    viewer.store.dispatch(Mirador.addWindow(windowConfig(manifest, canvasId)));
  }
}

/**
 * Wire the divider and the close/hide buttons.
 * `r`: { pane, host, resizer, closeButton, hideButton }.
 */
export function bindIiifPane(store, r) {
  refs = r;
  const { pane, resizer } = r;
  r.closeButton?.addEventListener("click", closeIiifPane);
  r.hideButton?.addEventListener("click", () => setCollapsed(true));
  if (!pane || !resizer) return;

  const commit = (w) => setUi(store, { viewerWidth: clampViewerWidth(w, room()) });
  const toggle = () => { if (isOpen()) setCollapsed(!body().contains("viewer-collapsed")); };
  // A click on the collapsed divider restores the pane; the dblclick that the
  // same double-click then fires must not collapse it again.
  let restoredAt = 0;

  let startX = 0;
  let startWidth = 0;
  let moved = false;
  const onMove = (e) => {
    if (Math.abs(e.clientX - startX) > 2) moved = true;
    pane.style.flexBasis = `${clampViewerWidth(startWidth - (e.clientX - startX), room())}px`;
  };
  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    body().remove("viewer-resizing");
    if (moved) commit(pane.getBoundingClientRect().width);
  };
  resizer.addEventListener("pointerdown", (e) => {
    if (body().contains("viewer-collapsed")) return; // a click restores it (dblclick/Enter)
    e.preventDefault();
    startX = e.clientX;
    startWidth = pane.getBoundingClientRect().width;
    moved = false;
    body().add("viewer-resizing");
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
  resizer.addEventListener("dblclick", () => { if (Date.now() - restoredAt > 600) toggle(); });
  resizer.addEventListener("click", () => {
    if (!body().contains("viewer-collapsed")) return;
    setCollapsed(false);
    restoredAt = Date.now();
  });
  resizer.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") toggle();
    else if (e.key === "ArrowLeft") commit(pane.getBoundingClientRect().width + KEY_STEP);
    else if (e.key === "ArrowRight") commit(pane.getBoundingClientRect().width - KEY_STEP);
    else return;
    e.preventDefault();
  });
  window.addEventListener("resize", () => syncIiifPane(refs, store.get().ui));
  // The narrow layout hides the pane; leaving it open there would hide content.
  window.matchMedia("(max-width: 767.98px)").addEventListener("change", (e) => { if (e.matches) closeIiifPane(); });
}

/** Reflect state.ui.viewerWidth onto the pane. */
export function syncIiifPane(r, ui) {
  if (!r || !r.pane || body().contains("viewer-resizing")) return;
  r.pane.style.flexBasis = `${clampViewerWidth(ui && ui.viewerWidth, room())}px`;
}
