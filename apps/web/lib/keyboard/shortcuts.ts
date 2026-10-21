/** Where `g` then a key goes. */
const GO_TO = { c: "/", t: "/tags", s: "/settings" } as const;

export type GoToPath = (typeof GO_TO)[keyof typeof GO_TO];

/** What a shortcut asks the app to do. */
export type ShortcutAction =
  | { type: "show-shortcuts" }
  | { type: "focus-search" }
  | { type: "new-clipping" }
  | { type: "go-to"; path: GoToPath }
  | { type: "toggle-appearance" }
  | { type: "leave-clipping" };

/** The parts of a `keydown` the matcher reads, plus what the listener works out from the DOM. */
export interface KeyInput {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  /** The event's target is a field the user types in. */
  targetIsEditable: boolean;
  /** A dialog, menu or popover is open: it owns the keyboard. */
  overlayOpen: boolean;
  /** The page is a clipping (`/c/<id>`). */
  onClipping: boolean;
  /**
   * Character-key shortcuts are on. They can be turned off in Settings (WCAG 2.1.4), for speech
   * input, which would trigger them by dictating; Esc keeps working.
   */
  characterKeys: boolean;
}

/** `g` was pressed at `at` (ms), and a second key within `SEQUENCE_MS` finishes the shortcut. */
export interface PendingSequence {
  at: number;
}

/** How long `g` waits for its second key. */
export const SEQUENCE_MS = 1000;

export interface MatchResult {
  action: ShortcutAction | null;
  pending: PendingSequence | null;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

/**
 * What a key press does, given the `g` sequence in progress (if any) and the time in ms. Returns
 * the action to run, if any, and the sequence to carry to the next key. A key that is ignored
 * (typing in a field, a dialog open, Ctrl/Cmd/Alt held) drops the sequence; a held key, a
 * composition and a bare modifier leave it as it was.
 */
export function matchShortcut(
  input: KeyInput,
  pending: PendingSequence | null,
  now: number,
): MatchResult {
  if (input.repeat || input.isComposing || MODIFIER_KEYS.has(input.key)) {
    return { action: null, pending };
  }
  const none: MatchResult = { action: null, pending: null };
  if (input.ctrlKey || input.metaKey || input.altKey) return none;
  if (input.targetIsEditable || input.overlayOpen) return none;

  if (input.key === "Escape") {
    return input.onClipping ? { action: { type: "leave-clipping" }, pending: null } : none;
  }
  if (!input.characterKeys) return none;

  // One character: named keys (`Enter`, `ArrowUp`) never match a letter.
  const letter = input.key.length === 1 ? input.key.toLowerCase() : "";

  const waiting = pending !== null && now - pending.at <= SEQUENCE_MS;
  if (waiting && !input.shiftKey && letter in GO_TO) {
    return { action: { type: "go-to", path: GO_TO[letter as keyof typeof GO_TO] }, pending: null };
  }

  // `?` and `/` are matched by the character: `?` is Shift+/ on a US keyboard, `/` is Shift+7 on a
  // German one.
  if (input.key === "?") return { action: { type: "show-shortcuts" }, pending: null };
  if (input.key === "/") return { action: { type: "focus-search" }, pending: null };
  if (letter === "n" && !input.shiftKey) {
    return { action: { type: "new-clipping" }, pending: null };
  }
  if (letter === "g" && !input.shiftKey) return { action: null, pending: { at: now } };
  if (letter === "d" && input.shiftKey) {
    return { action: { type: "toggle-appearance" }, pending: null };
  }
  return none;
}

/** The mode to switch to: the opposite of what is showing, which `system` leaves to the device. */
export function oppositeTheme(
  theme: "light" | "dark" | "system",
  systemIsDark: boolean,
): "light" | "dark" {
  const showing = theme === "system" ? (systemIsDark ? "dark" : "light") : theme;
  return showing === "dark" ? "light" : "dark";
}

/** Whether a clipping page is `/c/<id>`, with or without a trailing slash. */
export function isClippingPath(pathname: string): boolean {
  return /^\/c\/[^/]+\/?$/.test(pathname);
}
