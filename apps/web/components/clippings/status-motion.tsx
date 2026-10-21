"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

import type { ClippingStatus } from "@clippings/shared";

/** The animations a status change runs, in `app/list-motion.css`. */
const STATUS_ANIMATIONS = new Set(["status-resize", "status-fade-in", "status-rise"]);

/**
 * A list row's paper, which glides to its new height when the clipping's status changes (a pending
 * row becoming ready or failed) while the new text eases in, so the list below never jumps. Its
 * text column takes `status-content`. See `app/list-motion.css`.
 */
export function StatusMotion({
  status,
  className,
  children,
}: {
  status: ClippingStatus;
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<{ status: ClippingStatus; height: number } | null>(null);

  // After every commit: remember the sheet's height, and when the status changed, glide from the
  // height it had. A commit mid-glide leaves the glide alone.
  useLayoutEffect(() => {
    const sheet = ref.current;
    if (!sheet) return;
    const previous = last.current;
    if (previous && previous.status !== status) {
      // Measured without the running glide's height; the read also restarts the animation below.
      delete sheet.dataset.statusChanged;
      const height = sheet.offsetHeight;
      sheet.style.setProperty("--status-from-height", `${previous.height}px`);
      sheet.style.setProperty("--status-to-height", `${height}px`);
      sheet.dataset.statusChanged = "";
      last.current = { status, height };
    } else if (sheet.dataset.statusChanged === undefined) {
      last.current = { status, height: sheet.offsetHeight };
    }
  });

  return (
    <div
      ref={ref}
      className={className}
      onAnimationEnd={(event) => {
        // Done once the glide and the text have finished; reduced motion ends the glide first.
        const sheet = event.currentTarget;
        const running = sheet
          .getAnimations({ subtree: true })
          .some(
            (animation) =>
              animation instanceof CSSAnimation &&
              STATUS_ANIMATIONS.has(animation.animationName) &&
              animation.playState !== "finished",
          );
        if (!running) delete sheet.dataset.statusChanged;
      }}
    >
      {children}
    </div>
  );
}
