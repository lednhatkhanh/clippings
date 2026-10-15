"use client";

import { useState } from "react";

import { Icon } from "@clippings/ui";

function faviconUrl(pageUrl: string): string | null {
  try {
    return `${new URL(pageUrl).origin}/favicon.ico`;
  } catch {
    return null;
  }
}

/**
 * The site's own favicon, straight from its origin, with a globe when it has none. Enrichment
 * will store a proper one; until then no third-party favicon service learns what is saved.
 */
export function Favicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const source = faviconUrl(url);

  if (failed || !source) {
    return (
      <span className="shrink-0">
        <Icon name="language" />
      </span>
    );
  }
  return (
    // oxlint-disable-next-line nextjs/no-img-element -- arbitrary origins, 20px, never optimized
    <img
      src={source}
      alt=""
      width={20}
      height={20}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-5 shrink-0 rounded-xs"
    />
  );
}
