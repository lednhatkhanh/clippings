import type { Route } from "next";

/** The navigation's sections, in the order the rail lists them. */
export const SECTION_HREFS = ["/", "/tags", "/settings"] as const satisfies readonly Route[];

/**
 * The transition type a link in the navigation adds. Between sections the new page drifts in the
 * direction of the move: `section-lower` when the target sits lower in the rail (the page drifts
 * up), `section-higher` when it sits higher (the page drifts down). Leaving a clipping for its
 * list is `nav-back`.
 */
export type SectionTransition = "section-lower" | "section-higher" | "nav-back";

/**
 * Which section a path belongs to, by index into `SECTION_HREFS`, or -1 for a path outside them.
 * The list owns its detail pages (`/c/[id]`), so those belong to "Clippings".
 */
export function sectionIndex(pathname: string): number {
  if (pathname === "/" || pathname.startsWith("/c/")) return 0;
  return SECTION_HREFS.findIndex(
    (href, index) => index > 0 && (pathname === href || pathname.startsWith(`${href}/`)),
  );
}

/** The transition type for a click on the section at `href` from `pathname`, if it moves at all. */
export function sectionTransitionType(
  pathname: string,
  href: string,
): SectionTransition | undefined {
  const from = sectionIndex(pathname);
  const to = sectionIndex(href);
  if (to === -1 || from === -1) return undefined;
  if (from === to) return pathname.startsWith("/c/") ? "nav-back" : undefined;
  return to > from ? "section-lower" : "section-higher";
}
