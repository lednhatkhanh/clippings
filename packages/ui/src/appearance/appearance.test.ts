import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import { APPEARANCE_DEFAULTS, type Appearance } from "@clippings/shared";

import {
  APPEARANCE_COOKIE,
  APPEARANCE_STORAGE_KEYS,
  NO_FLASH_SCRIPT,
  appearanceTransitionFor,
  applyAppearance,
  encodeAppearanceCookie,
  transitionAppearance,
} from "./appearance.ts";

const saved: Appearance = { theme: "dark", palette: "ochre", contrast: "high", density: "compact" };

function fakeRoot() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
  };
}

function fakeStorage(initial: Record<string, string> = {}, throws = false) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => {
      if (throws) throw new Error("blocked");
      return items.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (throws) throw new Error("blocked");
      items.set(key, value);
    },
  };
}

/** A cookie jar behind `document.cookie`: assigning a `Max-Age=0` cookie deletes it. */
function fakeDocument(cookies: Record<string, string> = {}) {
  const jar = new Map(Object.entries(cookies));
  const root = fakeRoot();
  return {
    jar,
    root,
    document: {
      documentElement: root,
      get cookie() {
        return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
      },
      set cookie(assignment: string) {
        const [pair = "", ...flags] = assignment.split(";").map((part) => part.trim());
        const [name = "", value = ""] = pair.split("=");
        if (flags.includes("Max-Age=0")) jar.delete(name);
        else jar.set(name, value);
      },
    },
  };
}

function runScript(document: object, localStorage: object) {
  runInNewContext(NO_FLASH_SCRIPT, { document, localStorage });
}

const attributesOf = (root: ReturnType<typeof fakeRoot>) => Object.fromEntries(root.attributes);

describe("encodeAppearanceCookie", () => {
  it("is a URI-encoded JSON object the script can read back", () => {
    expect(JSON.parse(decodeURIComponent(encodeAppearanceCookie(saved)))).toEqual(saved);
    expect(encodeAppearanceCookie(saved)).not.toMatch(/[;,\s"]/);
  });
});

describe("NO_FLASH_SCRIPT", () => {
  it("sets the attributes from local storage and drops 'system' and defaults to no attribute", () => {
    const { document, root } = fakeDocument();
    const storage = fakeStorage({
      [APPEARANCE_STORAGE_KEYS.theme]: "dark",
      [APPEARANCE_STORAGE_KEYS.palette]: "terracotta",
      [APPEARANCE_STORAGE_KEYS.contrast]: "system",
    });

    runScript(document, storage);

    expect(attributesOf(root)).toEqual({
      "data-theme": "dark",
      "data-palette": "terracotta",
      "data-density": "comfortable",
    });
  });

  it("lets the handoff cookie win over storage, mirrors it to storage and deletes it", () => {
    const { document, root, jar } = fakeDocument({
      other: "1",
      [APPEARANCE_COOKIE]: encodeAppearanceCookie(saved),
    });
    const storage = fakeStorage({ [APPEARANCE_STORAGE_KEYS.theme]: "light" });

    runScript(document, storage);

    expect(attributesOf(root)).toEqual({
      "data-theme": "dark",
      "data-palette": "ochre",
      "data-contrast": "high",
      "data-density": "compact",
    });
    expect(Object.fromEntries(storage.items)).toEqual({
      [APPEARANCE_STORAGE_KEYS.theme]: "dark",
      [APPEARANCE_STORAGE_KEYS.palette]: "ochre",
      [APPEARANCE_STORAGE_KEYS.contrast]: "high",
      [APPEARANCE_STORAGE_KEYS.density]: "compact",
    });
    expect(jar.has(APPEARANCE_COOKIE)).toBe(false);
    expect(jar.get("other")).toBe("1");
  });

  it("takes each key from the cookie, then storage, then the default, ignoring invalid values", () => {
    const partial = encodeURIComponent(
      JSON.stringify({ theme: "dark", palette: "neon", contrast: 3 }),
    );
    const { document, root } = fakeDocument({ [APPEARANCE_COOKIE]: partial });
    const storage = fakeStorage({
      [APPEARANCE_STORAGE_KEYS.theme]: "light",
      [APPEARANCE_STORAGE_KEYS.palette]: "ink",
      [APPEARANCE_STORAGE_KEYS.density]: "huge",
    });

    runScript(document, storage);

    expect(attributesOf(root)).toEqual({
      "data-theme": "dark",
      "data-palette": "ink",
      "data-density": "comfortable",
    });
    expect(storage.items.get(APPEARANCE_STORAGE_KEYS.theme)).toBe("dark");
    expect(storage.items.has(APPEARANCE_STORAGE_KEYS.contrast)).toBe(false);
  });

  it("does not throw on a malformed cookie, and still removes it", () => {
    for (const value of ["%E0%A4%A", "not-json", "null", "42", encodeURIComponent('"dark"')]) {
      const { document, root, jar } = fakeDocument({ [APPEARANCE_COOKIE]: value });
      const storage = fakeStorage({ [APPEARANCE_STORAGE_KEYS.theme]: "light" });

      expect(() => runScript(document, storage), value).not.toThrow();
      expect(attributesOf(root), value).toMatchObject({ "data-theme": "light" });
      expect(jar.has(APPEARANCE_COOKIE), value).toBe(false);
    }
  });

  it("does not throw when storage is blocked, and the cookie still applies", () => {
    const { document, root } = fakeDocument({ [APPEARANCE_COOKIE]: encodeAppearanceCookie(saved) });

    expect(() => runScript(document, fakeStorage({}, true))).not.toThrow();
    expect(attributesOf(root)).toMatchObject({ "data-theme": "dark", "data-palette": "ochre" });

    const plain = fakeDocument();
    expect(() => runScript(plain.document, fakeStorage({}, true))).not.toThrow();
    expect(attributesOf(plain.root)).toEqual({
      "data-palette": APPEARANCE_DEFAULTS.palette,
      "data-density": APPEARANCE_DEFAULTS.density,
    });
  });
});

describe("applyAppearance", () => {
  it("sets the attributes, removes them for 'system' and mirrors every value to storage", () => {
    const root = fakeRoot();
    const storage = fakeStorage();
    root.setAttribute("data-theme", "dark");

    applyAppearance({ ...saved, theme: "system", contrast: "system" }, { root, storage });

    expect(attributesOf(root)).toEqual({ "data-palette": "ochre", "data-density": "compact" });
    expect(Object.fromEntries(storage.items)).toEqual({
      [APPEARANCE_STORAGE_KEYS.theme]: "system",
      [APPEARANCE_STORAGE_KEYS.palette]: "ochre",
      [APPEARANCE_STORAGE_KEYS.contrast]: "system",
      [APPEARANCE_STORAGE_KEYS.density]: "compact",
    });
  });

  it("still applies the attributes when storage is blocked", () => {
    const root = fakeRoot();

    expect(() => applyAppearance(saved, { root, storage: fakeStorage({}, true) })).not.toThrow();
    expect(attributesOf(root)).toEqual({
      "data-theme": "dark",
      "data-palette": "ochre",
      "data-contrast": "high",
      "data-density": "compact",
    });
  });
});

describe("appearanceTransitionFor", () => {
  it("crossfades light and dark, palette and contrast", () => {
    expect(appearanceTransitionFor("theme")).toBe("fade");
    expect(appearanceTransitionFor("palette")).toBe("fade");
    expect(appearanceTransitionFor("contrast")).toBe("fade");
  });

  it("doesn't animate density", () => {
    expect(appearanceTransitionFor("density")).toBe("none");
  });

  it("applies a revert after a failed save at once, whatever changed", () => {
    for (const key of ["theme", "palette", "contrast", "density"] as const) {
      expect(appearanceTransitionFor(key, { revert: true })).toBe("none");
    }
  });
});

describe("transitionAppearance", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs the update synchronously when view transitions are unavailable", () => {
    vi.stubGlobal("document", { documentElement: fakeRoot() });
    const update = vi.fn();

    transitionAppearance(update);

    expect(update).toHaveBeenCalledOnce();
  });

  function stubBrowser({
    reduced,
    tokens = { "--motion-ease-settle": " ease-in " },
  }: {
    reduced: boolean;
    tokens?: Record<string, string>;
  }) {
    const animate = vi.fn();
    const root = { ...fakeRoot(), animate };
    // One per transition started, oldest first.
    const finishers: (() => void)[] = [];
    const skipTransition = vi.fn();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return {
        ready: Promise.resolve(),
        finished: new Promise<void>((resolve) => {
          finishers.push(resolve);
        }),
        skipTransition,
      };
    });
    vi.stubGlobal("document", { documentElement: root, startViewTransition });
    vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
    vi.stubGlobal("innerWidth", 100);
    vi.stubGlobal("innerHeight", 200);
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: (name: string) => tokens[name] ?? "",
    }));
    return {
      root,
      animate,
      startViewTransition,
      skipTransition,
      finish: (index = finishers.length - 1) => finishers[index]!(),
    };
  }

  it("runs the update inside startViewTransition and reveals the new view from the origin", async () => {
    const { root, animate, startViewTransition, finish } = stubBrowser({ reduced: false });
    const update = vi.fn();

    transitionAppearance(update, { kind: "reveal", origin: { x: 10, y: 20 } });
    await Promise.resolve();

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(root.attributes.get("data-appearance-transition")).toBe("reveal");
    const [keyframes, options] = animate.mock.calls[0]!;
    expect(keyframes.clipPath[0]).toBe("circle(0 at 10px 20px)");
    // Farthest corner of a 100x200 viewport from (10, 20) is (100, 200): sqrt(90^2 + 180^2).
    expect(Number.parseFloat(keyframes.clipPath[1].slice("circle(".length))).toBeCloseTo(
      201.246,
      2,
    );
    expect(keyframes.clipPath[1]).toMatch(/ at 10px 20px\)$/);
    expect(options).toMatchObject({
      duration: 520,
      easing: "ease-in",
      pseudoElement: "::view-transition-new(root)",
    });

    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.attributes.has("data-appearance-transition")).toBe(false);
  });

  it("reads the reveal's duration from the slow motion token", async () => {
    const { animate } = stubBrowser({
      reduced: false,
      tokens: { "--motion-duration-slow": " 0.5s" },
    });

    transitionAppearance(vi.fn(), { kind: "reveal" });
    await Promise.resolve();

    expect(animate.mock.calls[0]![1]).toMatchObject({ duration: 500 });
  });

  it("crossfades when no kind is given", async () => {
    const { root, animate } = stubBrowser({ reduced: false });

    transitionAppearance(vi.fn());
    await Promise.resolve();

    expect(root.attributes.get("data-appearance-transition")).toBe("fade");
    expect(animate).not.toHaveBeenCalled();
  });

  it("crossfades a fade change without a reveal", async () => {
    const { root, animate, startViewTransition } = stubBrowser({ reduced: false });
    const update = vi.fn();

    transitionAppearance(update, { kind: "fade", origin: { x: 10, y: 20 } });
    await Promise.resolve();

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(root.attributes.get("data-appearance-transition")).toBe("fade");
    expect(animate).not.toHaveBeenCalled();
  });

  it("applies a change with no transition at once, outside a view transition", () => {
    const { root, startViewTransition } = stubBrowser({ reduced: false });
    const update = vi.fn();

    transitionAppearance(update, { kind: "none" });

    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(root.attributes.has("data-appearance-transition")).toBe(false);
  });

  it("skips a running appearance transition when a change applies at once", async () => {
    const { root, startViewTransition, skipTransition, finish } = stubBrowser({ reduced: false });

    transitionAppearance(vi.fn(), { kind: "reveal" });
    const revert = vi.fn();
    transitionAppearance(revert, { kind: "none" });

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(skipTransition).toHaveBeenCalledOnce();
    expect(revert).toHaveBeenCalledOnce();

    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.attributes.has("data-appearance-transition")).toBe(false);
  });

  it("keeps a newer transition's attribute when an older one finishes", async () => {
    const { root, finish } = stubBrowser({ reduced: false });

    transitionAppearance(vi.fn(), { kind: "reveal" });
    transitionAppearance(vi.fn(), { kind: "fade" });

    finish(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(root.attributes.get("data-appearance-transition")).toBe("fade");
  });

  it("only crossfades under reduced motion", async () => {
    for (const kind of ["reveal", "fade"] as const) {
      const { root, animate, startViewTransition } = stubBrowser({ reduced: true });
      const update = vi.fn();

      transitionAppearance(update, { kind });
      await Promise.resolve();

      expect(startViewTransition).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledOnce();
      expect(root.attributes.get("data-appearance-transition")).toBe("fade");
      expect(animate).not.toHaveBeenCalled();
    }
  });
});
