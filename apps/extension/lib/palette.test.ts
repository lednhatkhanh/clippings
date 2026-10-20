import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import {
  acceptSharedPalette,
  followStoredPalette,
  paintMirroredPalette,
  paintStoredPalette,
  readStoredPalette,
  storePalette,
} from "./palette.ts";

/** `<html>` and a page's local storage, in memory. */
function page(mirrored?: string) {
  const attributes = new Map<string, string>();
  const items = new Map<string, string>(mirrored ? [["clippings.palette", mirrored]] : []);
  return {
    root: {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      getAttribute: (name: string) => attributes.get(name) ?? null,
    },
    storage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    },
    items,
  };
}

describe("the palette", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("paints the mirrored palette before anything renders, or the default", () => {
    const ink = page("ink");
    expect(paintMirroredPalette(ink.root, ink.storage)).toBe("ink");
    expect(ink.root.getAttribute("data-palette")).toBe("ink");

    for (const fresh of [page(), page("neon")]) {
      paintMirroredPalette(fresh.root, fresh.storage);
      expect(fresh.root.getAttribute("data-palette")).toBe("olive");
    }
  });

  it("catches up with a palette synced since the mirror was written, before rendering", async () => {
    await storePalette("terracotta");
    const stale = page("ink");
    paintMirroredPalette(stale.root, stale.storage);

    await paintStoredPalette(stale.root, stale.storage);

    expect(stale.root.getAttribute("data-palette")).toBe("terracotta");
    expect(stale.items.get("clippings.palette")).toBe("terracotta");
  });

  it("keeps the mirrored palette before one is stored", async () => {
    const fresh = page("ochre");
    paintMirroredPalette(fresh.root, fresh.storage);
    await paintStoredPalette(fresh.root, fresh.storage);
    expect(fresh.root.getAttribute("data-palette")).toBe("ochre");
  });

  it("follows a palette refreshed while the page shows, until it stops", async () => {
    const open = page();
    paintMirroredPalette(open.root, open.storage);
    const apply = vi.fn((palette: string) => open.root.setAttribute("data-palette", palette));

    const stop = followStoredPalette(apply, open.root, open.storage);
    await storePalette("olive");
    await storePalette("ochre");
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith("ochre"));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(open.items.get("clippings.palette")).toBe("ochre");

    stop();
    await storePalette("ink");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("writes sync storage only when the palette changes", async () => {
    const writes = vi.spyOn(fakeBrowser.storage.sync, "set");
    await storePalette("ink");
    await storePalette("ink");
    expect(writes).toHaveBeenCalledTimes(1);
  });
});

describe("a palette shared by the web app", () => {
  const CLIPPINGS = "https://clippings.example";

  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("is stored when a Clippings page sends it", async () => {
    const message = { type: "palette", palette: "ochre" };
    expect(await acceptSharedPalette(message, { origin: CLIPPINGS }, CLIPPINGS)).toBe(true);
    expect(await readStoredPalette()).toBe("ochre");
  });

  it("is ignored from any other origin, or when it isn't a palette", async () => {
    const ochre = { type: "palette", palette: "ochre" };
    expect(await acceptSharedPalette(ochre, { origin: "https://evil.example" }, CLIPPINGS)).toBe(
      false,
    );
    expect(await acceptSharedPalette(ochre, {}, CLIPPINGS)).toBe(false);
    for (const message of [{ type: "palette", palette: "neon" }, { palette: "ochre" }, "ochre"]) {
      expect(await acceptSharedPalette(message, { origin: CLIPPINGS }, CLIPPINGS)).toBe(false);
    }
    expect(await readStoredPalette()).toBeNull();
  });
});
