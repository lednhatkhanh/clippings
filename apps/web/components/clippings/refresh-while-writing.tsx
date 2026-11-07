"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** How often the page asks the server how the brief is coming along. */
const REFRESH_EVERY_MS = 8_000;

/** A brief takes a minute or two; past this, whatever is wrong, the page stops asking. */
const GIVE_UP_AFTER_MS = 5 * 60 * 1000;

/**
 * Shown while a brief is being written right now: refreshes the page every few seconds, so the
 * brief appears when it is ready, and stops after five minutes or when it unmounts (the brief
 * changed state). It asks nothing while the tab is in the background.
 */
export function RefreshWhileWriting() {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, REFRESH_EVERY_MS);
    const giveUp = setTimeout(() => clearInterval(timer), GIVE_UP_AFTER_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(giveUp);
    };
  }, [router]);

  return null;
}
