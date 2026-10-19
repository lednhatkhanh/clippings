"use client";

import { Button } from "@clippings/ui";

/**
 * Reloads the address the user asked for: the worker shows this page in place of it, so the URL
 * is still theirs.
 */
export function RetryButton() {
  return <Button onPress={() => window.location.reload()}>Retry</Button>;
}
