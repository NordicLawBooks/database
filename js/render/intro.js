// "About the database" panel under the banner. Open on a first visit; whether it
// is collapsed is a device pref (state.ui.introHidden), like the facet sidebar.

import { setUi } from "./sidebar.js";

/** Wire the toggle. `refs`: { toggle, body }. */
export function bindIntro(store, refs) {
  refs.toggle?.addEventListener("click", () => {
    setUi(store, { introHidden: !store.get().ui.introHidden });
  });
}

/** Reflect state.ui.introHidden onto the page. */
export function syncIntro(refs, ui) {
  const hidden = !!(ui && ui.introHidden);
  if (refs.body) refs.body.hidden = hidden;
  refs.toggle?.setAttribute("aria-expanded", String(!hidden));
}
