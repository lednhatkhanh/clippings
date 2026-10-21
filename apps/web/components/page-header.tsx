import type { ReactNode } from "react";

import { cn } from "@clippings/ui";

/**
 * A page's glass header, and its `<h1>`. On a phone it floats at the top as a 56px bar with the
 * title centered between an optional `start` (a back button) and `end` (an action). From medium it
 * is a card at the top of the content column: an eyebrow line over the title in Fraunces, with the
 * page's `children` (actions, a search field, filters) on the right and below. Named, so page
 * transitions run beneath it without moving it.
 */
export function PageHeader({
  title,
  as: Title = "h1",
  compactOnly = false,
  eyebrow,
  start,
  end,
  children,
}: {
  title: ReactNode;
  /** `p` when the page's own content holds its `<h1>` (a clipping's title). */
  as?: "h1" | "p";
  /** Shown on a phone only, where it carries the way back; wider pages have their own. */
  compactOnly?: boolean;
  /** The small line above the title from medium: a date, or a few words of welcome. */
  eyebrow?: ReactNode;
  /** Before the title on a phone, such as a back button. */
  start?: ReactNode;
  /** After the title on a phone, such as a share button. */
  end?: ReactNode;
  /** The header's actions and controls, from medium. */
  children?: ReactNode;
}) {
  return (
    <header
      className={cn(
        "fixed inset-x-3 top-3 z-20 flex h-14 items-center justify-between rounded-lg-increased glass px-1.5 vt-anchored-header medium:static medium:mb-4 medium:h-auto medium:flex-col medium:items-stretch medium:gap-3.5 medium:rounded-xl medium:px-6 medium:py-5 print:static print:border-0 print:shadow-none",
        compactOnly && "medium:hidden print:hidden",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center justify-between gap-4 medium:items-end">
        <div className="flex size-11 shrink-0 items-center justify-center medium:hidden">
          {start}
        </div>
        <div className="min-w-0 flex-1 text-center medium:text-start">
          {eyebrow ? (
            <div className="hidden typescale-label-sm tracking-widest text-ink-faint uppercase medium:block">
              {eyebrow}
            </div>
          ) : null}
          <Title className="truncate typescale-title-lg medium:typescale-headline-lg">
            {title}
          </Title>
        </div>
        <div className="flex size-11 shrink-0 items-center justify-center medium:hidden">{end}</div>
        {children ? (
          <div className="hidden shrink-0 items-center gap-2 medium:flex">{children}</div>
        ) : null}
      </div>
    </header>
  );
}
