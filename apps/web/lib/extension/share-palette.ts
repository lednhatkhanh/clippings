import type { ExtensionPaletteMessage, PaletteName } from "@clippings/shared";

/** The part of `chrome.runtime` a web page sees when an installed extension lets it connect. */
interface ExternalRuntime {
  sendMessage(extensionId: string, message: unknown): Promise<unknown> | undefined;
}

/**
 * Tells the Clippings extension, when it is installed in this browser, the palette the user now
 * has, so its popup opens in it. Sent to each id the app trusts; the ones not installed refuse it.
 * Without any extension that lets the page connect, there is no `chrome.runtime` to send on, and
 * nothing happens. The extension checks the sender's origin and the message itself.
 */
export function sharePaletteWithExtension(
  palette: PaletteName,
  extensionIds: readonly string[],
): void {
  const runtime = (globalThis as { chrome?: { runtime?: Partial<ExternalRuntime> } }).chrome
    ?.runtime;
  if (typeof runtime?.sendMessage !== "function") return;
  const message: ExtensionPaletteMessage = { type: "palette", palette };
  for (const id of extensionIds) {
    try {
      runtime.sendMessage(id, message)?.catch(() => {
        // Not installed in this browser under this id.
      });
    } catch {
      // As above, in a browser that throws instead.
    }
  }
}
