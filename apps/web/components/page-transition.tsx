import { ViewTransition, type ReactNode } from "react";

/** The navigation types: `nav-top` from the navigation, `nav-forward`/`nav-back` within a page. */
const PAGE_CLASSES = {
  enter: { "nav-top": "fade-through-in", "nav-forward": "nav-forward", "nav-back": "nav-back" },
  exit: { "nav-top": "fade-through-out", "nav-forward": "nav-forward", "nav-back": "nav-back" },
} as const;

/**
 * A page's content as it enters and leaves on a typed navigation: top-level destinations fade
 * through, in-app forward and back slide along the x axis. Untyped navigations (a list row, the
 * browser's back button) leave it still, so the shared sheet morph is all that moves. The fade-out
 * on `nav-top` never meets that morph: the navigation's links don't open a clipping. It goes in
 * each `page.tsx`: layouts persist, so their enter and exit never fire.
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
 * on the browser's back button too: 500 ms into the detail, 400 ms back to the list.
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
