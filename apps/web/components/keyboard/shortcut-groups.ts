/** One row of the shortcuts sheet: what it does and the keys, shown in order. */
export interface ShortcutRow {
  label: string;
  keys: readonly string[];
  /** The word between keys that are pressed one after another or as alternatives. */
  between?: "then" | "or";
}

export interface ShortcutGroup {
  title: string;
  rows: readonly ShortcutRow[];
}

/**
 * What the shortcuts sheet lists. Each row is a shortcut that works today: `KeyboardShortcuts`
 * handles the first six, `CommandPalette` ⌘K, and React Aria the menu and dialog keys.
 */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Anywhere",
    rows: [
      { label: "Jump to anything", keys: ["⌘", "K"] },
      { label: "Search clippings", keys: ["/"] },
      { label: "New clipping", keys: ["N"] },
      { label: "Go to Clippings", keys: ["G", "C"], between: "then" },
      { label: "Go to Tags", keys: ["G", "T"], between: "then" },
      { label: "Go to Settings", keys: ["G", "S"], between: "then" },
      { label: "Toggle light and dark", keys: ["⇧", "D"] },
      { label: "Show this sheet", keys: ["?"] },
    ],
  },
  {
    title: "On a clipping",
    rows: [{ label: "Back to the list", keys: ["Esc"] }],
  },
  {
    title: "Menus and dialogs",
    rows: [
      { label: "Move", keys: ["↑", "↓"] },
      { label: "Choose", keys: ["↵", "Space"], between: "or" },
      { label: "Type to find an item", keys: ["A–Z"] },
      { label: "Close, focus returns", keys: ["Esc"] },
    ],
  },
];
