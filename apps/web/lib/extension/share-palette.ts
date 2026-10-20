import {
  CLIPPINGS_EXTENSION_ID,
  type ExtensionPaletteMessage,
  type PaletteName,
} from "@clippings/shared";

/** The part of `chrome.runtime` a web page sees when an installed extension lets it connect. */
interface ExternalRuntime {
  sendMessage(extensionId: string, message: unknown): Promise<unknown>;
}

/**
 * Tells the Clippings extension, when it is installed in this browser, the palette the user now
 * has, so its popup opens in it. Without the extension the page has no `chrome.runtime` to send
 * on, and nothing happens. The extension checks the sender's origin and the message itself.
 */
export function sharePaletteWithExtension(palette: PaletteName): void {
  const runtime = (globalThis as { chrome?: { runtime?: Partial<ExternalRuntime> } }).chrome
    ?.runtime;
  if (typeof runtime?.sendMessage !== "function") return;
  const message: ExtensionPaletteMessage = { type: "palette", palette };
  try {
    runtime.sendMessage(CLIPPINGS_EXTENSION_ID, message)?.catch(() => {
      // Another extension let the page connect, not Clippings: nothing to tell.
    });
  } catch {
    // As above, in a browser that throws instead.
  }
}
