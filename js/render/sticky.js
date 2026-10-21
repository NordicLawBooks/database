// Size the results to the window below the sticky toolbar. The table and sidebar
// heights are `100vh - --sticky-h`, where --sticky-h is the distance from the
// toolbar's top to the results' top (toolbar + result-count row). That makes the
// page exactly tall enough for the toolbar to reach the top and stick, however
// much sits above it (banner, intro) and however the toolbar wraps.

/** Keep --sticky-h on <html> in step with `controls` → `layout`. */
export function trackStickyHeight(controls, layout) {
  if (!controls || !layout) return;
  const update = () => {
    const h = layout.getBoundingClientRect().top - controls.getBoundingClientRect().top;
    document.documentElement.style.setProperty("--sticky-h", `${Math.round(h)}px`);
  };
  update();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(update);
    ro.observe(controls);
    if (layout.previousElementSibling) ro.observe(layout.previousElementSibling);
  }
  window.addEventListener("resize", update);
}
