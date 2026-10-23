import { useEffect, useState } from "react";

/** Rows just outside the viewport count as on screen, so an answer is ready when they scroll in. */
const ROOT_MARGIN = "200px 0px";

/**
 * Whether the element is on (or near) the screen. Pass it as state, from a callback ref: a React
 * Aria collection item renders its element after the component that holds the ref has committed. Nothing is observed while `enabled` is false,
 * so a list only pays for the rows that need to know.
 */
export function useOnScreen(element: Element | null, enabled: boolean): boolean {
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    if (!enabled || !element) return;
    const observer = new IntersectionObserver(
      (entries) => setOnScreen(entries.at(-1)?.isIntersecting ?? false),
      { rootMargin: ROOT_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, enabled]);

  return enabled && onScreen;
}
