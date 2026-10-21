import { describe, expect, it } from "vitest";

import {
  isClippingPath,
  matchShortcut,
  oppositeTheme,
  SEQUENCE_MS,
  type KeyInput,
  type PendingSequence,
  type ShortcutAction,
} from "./shortcuts.ts";

function press(key: string, overrides: Partial<KeyInput> = {}): KeyInput {
  return {
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    targetIsEditable: false,
    overlayOpen: false,
    onClipping: false,
    characterKeys: true,
    ...overrides,
  };
}

const NOW = 10_000;
const afterG: PendingSequence = { at: NOW };

describe("single keys", () => {
  const cases: [string, KeyInput, ShortcutAction][] = [
    ["? opens the sheet", press("?", { shiftKey: true }), { type: "show-shortcuts" }],
    ["? on a layout without Shift", press("?"), { type: "show-shortcuts" }],
    ["/ focuses search", press("/"), { type: "focus-search" }],
    [
      "/ typed with Shift (Shift+7 on a German layout)",
      press("/", { shiftKey: true }),
      { type: "focus-search" },
    ],
    ["n opens a new clipping", press("n"), { type: "new-clipping" }],
    ["N with Caps Lock too", press("N"), { type: "new-clipping" }],
    ["Shift+D toggles the mode", press("D", { shiftKey: true }), { type: "toggle-appearance" }],
    ["Shift+D with Caps Lock on", press("d", { shiftKey: true }), { type: "toggle-appearance" }],
    [
      "Esc on a clipping goes back",
      press("Escape", { onClipping: true }),
      { type: "leave-clipping" },
    ],
  ];

  it.each(cases)("%s", (_name, input, action) => {
    expect(matchShortcut(input, null, NOW)).toEqual({ action, pending: null });
  });

  const nothing: [string, KeyInput][] = [
    ["d without Shift", press("d")],
    ["Shift+N", press("N", { shiftKey: true })],
    ["Esc off a clipping", press("Escape")],
    ["an arrow key", press("ArrowDown")],
    ["a word key that starts with a shortcut's letter", press("Enter")],
    ["an unknown letter", press("x")],
  ];

  it.each(nothing)("%s does nothing", (_name, input) => {
    expect(matchShortcut(input, null, NOW)).toEqual({ action: null, pending: null });
  });
});

describe("g then a key", () => {
  it("g starts a sequence", () => {
    expect(matchShortcut(press("g"), null, NOW)).toEqual({ action: null, pending: { at: NOW } });
  });

  it.each([
    ["c", "/"],
    ["t", "/tags"],
    ["s", "/settings"],
    ["T", "/tags"],
  ] as const)("g then %s goes to %s", (key, path) => {
    expect(matchShortcut(press(key), afterG, NOW + 300)).toEqual({
      action: { type: "go-to", path },
      pending: null,
    });
  });

  it("accepts the second key exactly at the limit", () => {
    expect(matchShortcut(press("t"), afterG, NOW + SEQUENCE_MS).action).toEqual({
      type: "go-to",
      path: "/tags",
    });
  });

  it("forgets the sequence after the limit", () => {
    expect(matchShortcut(press("t"), afterG, NOW + SEQUENCE_MS + 1)).toEqual({
      action: null,
      pending: null,
    });
  });

  it("an unknown second key resets the sequence", () => {
    expect(matchShortcut(press("x"), afterG, NOW + 100)).toEqual({ action: null, pending: null });
    expect(matchShortcut(press("Enter"), afterG, NOW + 100)).toEqual({
      action: null,
      pending: null,
    });
  });

  it("a shifted second key does not complete it", () => {
    expect(matchShortcut(press("T", { shiftKey: true }), afterG, NOW + 100)).toEqual({
      action: null,
      pending: null,
    });
  });

  it("g again restarts the wait from the second press", () => {
    expect(matchShortcut(press("g"), afterG, NOW + 800)).toEqual({
      action: null,
      pending: { at: NOW + 800 },
    });
  });

  it("another shortcut after g runs and ends the sequence", () => {
    expect(matchShortcut(press("n"), afterG, NOW + 100)).toEqual({
      action: { type: "new-clipping" },
      pending: null,
    });
  });

  it("t alone does nothing", () => {
    expect(matchShortcut(press("t"), null, NOW).action).toBeNull();
  });
});

describe("what is ignored", () => {
  const keys = [press("?", { shiftKey: true }), press("/"), press("n"), press("g")];

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
    ["Alt", { altKey: true }],
  ] as const)("%s held", (_name, modifier) => {
    for (const key of keys) {
      expect(matchShortcut({ ...key, ...modifier }, null, NOW)).toEqual({
        action: null,
        pending: null,
      });
    }
    expect(matchShortcut(press("D", { shiftKey: true, ...modifier }), null, NOW).action).toBeNull();
  });

  it("typing in a field, and it drops a sequence in progress", () => {
    for (const key of keys) {
      expect(matchShortcut({ ...key, targetIsEditable: true }, null, NOW).action).toBeNull();
    }
    expect(matchShortcut(press("t", { targetIsEditable: true }), afterG, NOW)).toEqual({
      action: null,
      pending: null,
    });
    expect(
      matchShortcut(press("Escape", { targetIsEditable: true, onClipping: true }), null, NOW)
        .action,
    ).toBeNull();
  });

  it("a dialog, menu or popover open", () => {
    for (const key of keys) {
      expect(matchShortcut({ ...key, overlayOpen: true }, null, NOW).action).toBeNull();
    }
    expect(
      matchShortcut(press("Escape", { overlayOpen: true, onClipping: true }), null, NOW).action,
    ).toBeNull();
    expect(matchShortcut(press("t", { overlayOpen: true }), afterG, NOW).action).toBeNull();
  });

  it("a held key leaves the sequence as it was", () => {
    expect(matchShortcut(press("n", { repeat: true }), afterG, NOW)).toEqual({
      action: null,
      pending: afterG,
    });
    expect(matchShortcut(press("g", { repeat: true }), null, NOW)).toEqual({
      action: null,
      pending: null,
    });
  });

  it("a composition (IME) is left alone", () => {
    expect(matchShortcut(press("n", { isComposing: true }), afterG, NOW)).toEqual({
      action: null,
      pending: afterG,
    });
  });

  it("a bare modifier between g and the second key keeps the sequence", () => {
    expect(matchShortcut(press("Shift", { shiftKey: true }), afterG, NOW)).toEqual({
      action: null,
      pending: afterG,
    });
  });
});

describe("oppositeTheme", () => {
  it.each([
    ["light", false, "dark"],
    ["dark", false, "light"],
    ["system", false, "dark"],
    ["system", true, "light"],
  ] as const)("%s (device dark: %s) switches to %s", (theme, systemIsDark, expected) => {
    expect(oppositeTheme(theme, systemIsDark)).toBe(expected);
  });
});

describe("isClippingPath", () => {
  it.each([
    ["/c/abc", true],
    ["/c/abc/", true],
    ["/c/", false],
    ["/c/abc/def", false],
    ["/", false],
    ["/tags", false],
  ] as const)("%s is %s", (path, expected) => {
    expect(isClippingPath(path)).toBe(expected);
  });
});

describe("with character-key shortcuts turned off", () => {
  it.each(["?", "/", "n", "g", "D"])("ignores %s", (key) => {
    const result = matchShortcut(
      press(key, { characterKeys: false, shiftKey: key === "?" || key === "D" }),
      null,
      NOW,
    );
    expect(result).toEqual({ action: null, pending: null });
  });

  it("drops a `g` already waiting", () => {
    expect(matchShortcut(press("t", { characterKeys: false }), afterG, NOW + 10)).toEqual({
      action: null,
      pending: null,
    });
  });

  it("still leaves a clipping on Esc", () => {
    expect(
      matchShortcut(press("Escape", { characterKeys: false, onClipping: true }), null, NOW).action,
    ).toEqual({ type: "leave-clipping" });
  });
});
