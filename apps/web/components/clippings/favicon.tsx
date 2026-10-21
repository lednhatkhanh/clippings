"use client";

import { useState } from "react";

import { cn } from "@clippings/ui";

import { faviconInitial } from "./favicon-initial.ts";

function faviconUrl(pageUrl: string): string | null {
  try {
    return `${new URL(pageUrl).origin}/favicon.ico`;
  } catch {
    return null;
  }
}

/** `row` is the list's 36px tile; `inline` the 22px one beside a domain. */
const TILES = {
  row: { tile: "size-9 rounded-md text-base", image: "size-5" },
  inline: { tile: "size-5.5 rounded-sm text-xs", image: "size-3.5" },
} as const;

/**
 * A small paper tile with the site's own favicon, straight from its origin, or the first letter of
 * its domain in the serif when it has none. Enrichment will store a proper one; until then no
 * third-party favicon service learns what is saved.
 */
export function Favicon({ url, size = "row" }: { url: string; size?: keyof typeof TILES }) {
  const [failed, setFailed] = useState(false);
  const source = faviconUrl(url);
  const { tile, image } = TILES[size];

  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center paper text-ink-muted", tile)}
    >
      {failed || !source ? (
        <span className="font-serif font-semibold">{faviconInitial(url)}</span>
      ) : (
        // oxlint-disable-next-line nextjs/no-img-element -- arbitrary origins, 20px, never optimized
        <img
          src={source}
          alt=""
          width={20}
          height={20}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className={cn("rounded-xs", image)}
        />
      )}
    </span>
  );
}
