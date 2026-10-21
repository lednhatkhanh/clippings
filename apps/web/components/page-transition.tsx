import { ViewTransition, type ReactNode } from "react";

/**
 * The transition types, and the classes `view-transitions.css` gives them. Between sections the
 * paper drifts in the direction of the move (`section-lower`: up, `section-higher`: down). Going
 * deeper (`nav-forward`) and back (`nav-back`) it slides along the x axis.
 */
const PAGE_CLASSES = {
  enter: {
    "section-lower": "drift-in-up",
    "section-higher": "drift-in-down",
    "nav-forward": "slide-in-forward",
    "nav-back": "slide-in-back",
  },
  exit: {
    "section-lower": "drift-out-up",
    "section-higher": "drift-out-down",
    "nav-forward": "slide-out-forward",
    "nav-back": "slide-out-back",
  },
} as const;

/**
 * A page's content as it enters and leaves on a typed navigation: between sections it drifts a
 * few pixels up or down, and in-app forward and back slide along the x axis. The glass frame is
 * named elsewhere, so it holds still. Untyped navigations (a list row, the browser's back button)
 * leave it still, so the shared sheet morph is all that moves. It goes in each `page.tsx`:
 * layouts persist, so their enter and exit never fire.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition
      enter={{ ...PAGE_CLASSES.enter, default: "none" }}
      exit={{ ...PAGE_CLASSES.exit, default: "none" }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}

/** Content that replaces a Suspense skeleton fades in once it arrives, and nowhere else. */
export function RevealTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="content-in" default="none">
      {children}
    </ViewTransition>
  );
}

/** A Suspense skeleton fades out when its content arrives. */
export function SkeletonTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition exit="skeleton-out" default="none">
      {children}
    </ViewTransition>
  );
}

/**
 * The paper sheet a clipping shares between its list row and its detail page (a container
 * transform). The incoming side's class times the morph, so it needs no transition type and runs
 * on the browser's back button too, on the paper spring either way.
 */
export function SheetTransition({
  clippingId,
  direction,
  children,
}: {
  clippingId: string;
  direction: "in" | "back";
  children: ReactNode;
}) {
  return (
    <ViewTransition
      name={`clipping-${clippingId}`}
      share={direction === "in" ? "morph-in" : "morph-back"}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
