// Facet sidebar chrome: the Hide/Show facets toggle and the drag-to-resize handle.
// Both are device prefs (state.ui), persisted by prefs.js and kept out of the URL.

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 600;

export const clampSidebarWidth = (w) =>
  Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(Number(w) || 0)));

function setUi(store, patch) {
  const state = store.get();
  store.set({ ui: { ...state.ui, ...patch } }, { history: "silent" });
}

/** Wire the toggle button and resizer. `refs`: { toggle, sidebar, resizer }. */
export function bindSidebar(store, refs) {
  refs.toggle?.addEventListener("click", () => {
    setUi(store, { facetsHidden: !store.get().ui.facetsHidden });
  });

  const { sidebar, resizer } = refs;
  if (!sidebar || !resizer) return;
  let startX = 0;
  let startWidth = 0;
  const onMove = (e) => {
    sidebar.style.flexBasis = `${clampSidebarWidth(startWidth + (e.clientX - startX))}px`;
  };
  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.body.classList.remove("sidebar-resizing");
    setUi(store, { sidebarWidth: clampSidebarWidth(sidebar.getBoundingClientRect().width) });
  };
  resizer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    document.body.classList.add("sidebar-resizing");
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

/** Reflect state.ui (hidden flag, width) onto the page. */
export function syncSidebar(refs, ui) {
  const hidden = !!(ui && ui.facetsHidden);
  document.body.classList.toggle("facets-hidden", hidden);
  if (refs.toggle) refs.toggle.textContent = hidden ? "Show facets" : "Hide facets";
  if (refs.sidebar && !document.body.classList.contains("sidebar-resizing")) {
    refs.sidebar.style.flexBasis = `${clampSidebarWidth(ui && ui.sidebarWidth)}px`;
  }
}
