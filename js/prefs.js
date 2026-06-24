// Device preferences (column visibility, sidebar UI) persisted to localStorage.
// These are intentionally NOT part of the shareable URL state.

const KEY = "nordiclaw.prefs";

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    const out = {};
    if (p && p.columns) out.columns = p.columns;
    if (p && p.ui) out.ui = p.ui;
    return out;
  } catch {
    return {};
  }
}

export function savePrefs(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ columns: state.columns, ui: state.ui }));
  } catch {
    /* storage unavailable; ignore */
  }
}
