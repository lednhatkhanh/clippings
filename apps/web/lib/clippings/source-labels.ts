import type { ClippingSource } from "@clippings/shared";

/** What the app calls each source: `mcp` is Claude to the user. */
export const SOURCE_LABELS: Record<ClippingSource, string> = {
  web: "Web",
  extension: "Extension",
  mcp: "Claude",
  digest: "Digest",
};
