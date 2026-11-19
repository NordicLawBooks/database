// Show a modal "on top of" another one. Bootstrap does not support stacked
// modals (the lower modal's focus trap pulls focus back, so Escape would close
// the wrong one), so `returnTo` (an open modal) is hidden first and shown
// again, at the same scroll position, when `modalEl` closes.

export function showModalOver(modalEl, returnTo = null) {
  const bs = typeof window !== "undefined" ? window.bootstrap : null;
  if (!modalEl || !bs || !bs.Modal) return;
  const show = () => bs.Modal.getOrCreateInstance(modalEl).show();

  if (!returnTo || !returnTo.classList.contains("show")) {
    show();
    return;
  }
  const body = returnTo.querySelector(".modal-body");
  const scrollTop = body ? body.scrollTop : 0;
  returnTo.addEventListener("hidden.bs.modal", show, { once: true });
  modalEl.addEventListener("hidden.bs.modal", () => {
    returnTo.addEventListener("shown.bs.modal", () => { if (body) body.scrollTop = scrollTop; }, { once: true });
    bs.Modal.getOrCreateInstance(returnTo).show();
  }, { once: true });
  bs.Modal.getOrCreateInstance(returnTo).hide();
}
