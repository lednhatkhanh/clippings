import { Sparkles } from "lucide-react";

import { formatClippingDate } from "@/lib/format-date.ts";

/**
 * The mark on content the model wrote, not the user: an "AI-written" badge and when it was last
 * updated. Sits in a flex row of metadata, as a pair of its siblings.
 */
export function AiWritten({ updatedAt, now }: { updatedAt: string; now: Date }) {
  return (
    <>
      <span className="inline-flex h-5.5 items-center gap-1 rounded-sm border border-line-strong px-2 typescale-label-sm text-ink-muted">
        <Sparkles className="size-3" />
        AI-written
      </span>
      <span>
        Updated <time dateTime={updatedAt}>{formatClippingDate(updatedAt, now)}</time>
      </span>
    </>
  );
}
