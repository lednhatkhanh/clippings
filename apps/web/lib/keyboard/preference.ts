/**
 * Whether character-key shortcuts (`n`, `/`, `?`, `g`…) are on, on this device. They are on until
 * turned off in Settings; speech input users turn them off so dictated words don't fire them. Kept
 * in local storage, read on every key press, so a change applies at once in every tab.
 */
const KEY = "clippings:character-shortcuts";
const CHANGED = "clippings:character-shortcuts-changed";

export function characterShortcutsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setCharacterShortcuts(on: boolean) {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "off");
  } catch {
    // Storage blocked: the setting lasts for this page only, through the event below.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Calls `onChange` when the setting changes here or in another tab. */
export function subscribeCharacterShortcuts(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}
