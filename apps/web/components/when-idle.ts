/**
 * Runs `task` once the browser is idle (after a short delay where it has no idle callbacks), so
 * warming a lazy chunk never competes with the page's own load. Returns a function that cancels it.
 */
export function whenIdle(task: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: 4000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 1500);
  return () => window.clearTimeout(handle);
}
