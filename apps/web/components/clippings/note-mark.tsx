import { StickyNote } from "lucide-react";

import { cn } from "@clippings/ui";

/** `row` is the list's 36px tile; `inline` the 22px one beside the date. */
const TILES = {
  row: { tile: "size-9 rounded-md", icon: "size-5" },
  inline: { tile: "size-5.5 rounded-sm", icon: "size-3.5" },
} as const;

/** A note's tile where a link has its favicon: a paper tile with a note icon. */
export function NoteMark({ size = "row" }: { size?: keyof typeof TILES }) {
  const { tile, icon } = TILES[size];
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center paper text-ink-muted", tile)}
    >
      <StickyNote className={icon} />
    </span>
  );
}

/** The word that marks a note in a list row and on its detail page. */
export function NoteBadge() {
  return (
    <span className="inline-flex h-5.5 items-center rounded-sm border border-line-strong px-2 typescale-label-sm text-ink-muted">
      Note
    </span>
  );
}
