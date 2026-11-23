// Size the results to fill the window. On wide screens the page itself doesn't
// scroll: the facet sidebar, the results table and the image pane are
// `100vh - --results-top` tall, where --results-top is how far down the page the
// results start (below the banner, intro, toolbar and result-count row), so
// the results box has the only vertical scrollbar. On narrow screens the CSS
// drops those heights and the page scrolls instead.

/** Keep --results-top on <html> in step with the top of `layout`. */
export function trackResultsTop(layout) {
  if (!layout) return;
  const update = () => {
    const top = layout.getBoundingClientRect().top + window.scrollY;
    document.documentElement.style.setProperty("--results-top", `${Math.round(top)}px`);
  };
  update();
  // Everything above the results (intro toggled, toolbar wrapping, status text).
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(update);
    for (let el = layout.previousElementSibling; el; el = el.previousElementSibling) ro.observe(el);
  }
  window.addEventListener("resize", update);
}

const HIDE_AFTER = 48; // px scrolled down in the results before the header hides
const SHOW_BELOW = 8; // px from the top within which scrolling up brings it back
const SWIPE = 24; // px a finger must pull down at the top to bring it back

/**
 * On wide screens, fold away the banner and intro (`header`) once the results are
 * scrolled down, so the table gets their room, and bring them back when the
 * reader scrolls up at the top of the results. They stay hidden across new
 * searches and pages (a re-rendered view starts at the top, where no scroll event
 * fires), so a wheel, key or swipe upwards at the top also brings them back.
 * The fold itself is a CSS transition (index.html). Narrow screens scroll the
 * whole page, so the header simply scrolls away there.
 */
export function collapseHeaderOnScroll(results, header) {
  if (!results || !header || typeof window.matchMedia !== "function") return;
  const wide = window.matchMedia("(min-width: 768px)");
  const lastTop = new WeakMap();
  const isCollapsed = () => document.body.classList.contains("header-collapsed");
  const setCollapsed = (on) => {
    if (on === isCollapsed()) return;
    document.body.classList.toggle("header-collapsed", on);
    header.inert = on; // keep its links out of the tab order while folded away
  };
  const boxOf = (el) => (el && el.closest ? el.closest(".table-responsive") : null);
  const atTop = (box) => !box || box.scrollTop <= 0;

  results.addEventListener("scroll", (e) => {
    const box = e.target;
    if (!box.classList || !box.classList.contains("table-responsive")) return;
    const top = box.scrollTop;
    const prev = lastTop.get(box) ?? 0;
    lastTop.set(box, top);
    if (!wide.matches) return setCollapsed(false);
    if (!isCollapsed()) {
      // Only hide when the box stays scrolled past SHOW_BELOW once it grows by the
      // header's height; otherwise it would clamp to the top and flicker back.
      const room = box.scrollHeight - box.clientHeight - header.offsetHeight;
      if (top > prev && top > HIDE_AFTER && room > HIDE_AFTER) setCollapsed(true);
    } else if (top < prev && top < SHOW_BELOW) {
      setCollapsed(false);
    }
  }, { capture: true, passive: true });

  results.addEventListener("wheel", (e) => {
    if (isCollapsed() && e.deltaY < 0 && atTop(boxOf(e.target))) setCollapsed(false);
  }, { passive: true });
  results.addEventListener("keydown", (e) => {
    if (isCollapsed() && ["ArrowUp", "PageUp", "Home"].includes(e.key) && atTop(boxOf(e.target))) setCollapsed(false);
  });
  let touchY = null;
  results.addEventListener("touchstart", (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  results.addEventListener("touchmove", (e) => {
    if (touchY !== null && isCollapsed() && e.touches[0].clientY - touchY > SWIPE && atTop(boxOf(e.target))) setCollapsed(false);
  }, { passive: true });

  wide.addEventListener("change", () => { if (!wide.matches) setCollapsed(false); });
}
