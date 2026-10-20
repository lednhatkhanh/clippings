/**
 * The slice of the extension's `chrome.*` API the specs call from inside the browser
 * (`Worker.evaluate` and init scripts), which no package here types.
 */
interface ChromeTab {
  windowId: number;
  url?: string;
}

interface ChromeTabQuery {
  url?: string;
  active?: boolean;
  windowId?: number;
  currentWindow?: boolean;
}

declare const chrome: {
  tabs: { query: (info: ChromeTabQuery) => Promise<ChromeTab[]> };
  windows: { create: (info: { url: string; type: "popup" }) => Promise<unknown> };
};
