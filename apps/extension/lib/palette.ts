import { browser, type Browser } from "wxt/browser";

import {
  DEFAULT_PALETTE,
  extensionPaletteMessageSchema,
  isAppearanceValue,
  type PaletteName,
} from "@clippings/shared";

/**
 * The user's palette lives in sync storage, so each of their browsers has it: seeded from their
 * Clippings settings at sign-in and read again each time the popup opens.
 */
const SYNC_KEY = "palette";

/**
 * Sync storage only answers asynchronously, and the extension's pages can't run an inline script
 * (MV3's CSP) to wait for it before they paint. So each page also mirrors the palette into its
 * origin's local storage, which it can read synchronously before React renders.
 */
const MIRROR_KEY = "clippings.palette";

const asPalette = (value: unknown): PaletteName | null =>
  isAppearanceValue("palette", value) ? value : null;

/** Saves the palette for every extension page, in this browser and the user's others. */
export async function storePalette(palette: PaletteName): Promise<void> {
  await browser.storage.sync.set({ [SYNC_KEY]: palette });
}

/**
 * Takes the palette a Clippings page sends when the user picks one, so the popup opens in it
 * next time. Only from the Clippings web app's own origin; anything else is ignored.
 */
export async function acceptSharedPalette(
  message: unknown,
  sender: Browser.runtime.MessageSender,
  clippingsOrigin: string = import.meta.env.CLIPPINGS_ORIGIN,
): Promise<boolean> {
  if (sender.origin !== clippingsOrigin) return false;
  const shared = extensionPaletteMessageSchema.safeParse(message);
  if (!shared.success) return false;
  await storePalette(shared.data.palette);
  return true;
}

/** The palette in sync storage, or null before one is stored. */
export async function readStoredPalette(): Promise<PaletteName | null> {
  const stored = await browser.storage.sync.get(SYNC_KEY);
  return asPalette(stored[SYNC_KEY]);
}

type Root = Pick<HTMLElement, "setAttribute" | "getAttribute">;

/** Where a page keeps its synchronous copy: its own local storage, when that can be reached. */
function mirror(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Paints the mirrored palette on `<html>`, synchronously, so the page's first paint is in the
 * user's colors. Call it before React renders. Light or dark follows the OS: there is no theme
 * attribute to set.
 */
export function paintMirroredPalette(
  root: Root = document.documentElement,
  storage = mirror(),
): PaletteName {
  let palette: PaletteName = DEFAULT_PALETTE;
  try {
    palette = asPalette(storage?.getItem(MIRROR_KEY)) ?? DEFAULT_PALETTE;
  } catch {
    // Blocked storage: the default palette.
  }
  root.setAttribute("data-palette", palette);
  return palette;
}

/**
 * Keeps the page on the stored palette: once now, in case another browser synced a new one since
 * the mirror was written, and on every change after, such as the refresh the popup asks for when
 * it opens. A change goes through `apply`, which paints it (with a crossfade, on a page that is
 * showing) and the mirror is updated for the next first paint. Returns the unsubscribe.
 */
export function followStoredPalette(
  apply: (palette: PaletteName) => void,
  root: Root = document.documentElement,
  storage = mirror(),
): () => void {
  const follow = (palette: PaletteName | null) => {
    if (!palette) return;
    try {
      storage?.setItem(MIRROR_KEY, palette);
    } catch {
      // Blocked or full storage: the next page paints the default first, then this palette.
    }
    if (root.getAttribute("data-palette") !== palette) apply(palette);
  };

  const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
    if (SYNC_KEY in changes) follow(asPalette(changes[SYNC_KEY]?.newValue));
  };
  browser.storage.sync.onChanged.addListener(onChanged);
  readStoredPalette().then(follow, (error: unknown) =>
    console.error("Couldn't read the palette", error),
  );
  return () => browser.storage.sync.onChanged.removeListener(onChanged);
}
