import { Unlink } from "lucide-react";

import { formatAbsoluteDate } from "@clippings/shared";
import { Disclosure } from "@clippings/ui";

/**
 * Tells the user the page seems gone, since the date the weekly check first found it so, and,
 * when the clipping kept the page's text, lets them read what it said.
 */
export function DeadLinkNotice({
  deadSince,
  savedText,
  now,
}: {
  /** ISO 8601: when the page was first found gone. */
  deadSince: string;
  /** The text the page had when it was last read, or null when none was kept. */
  savedText: { text: string; fetchedAt: string } | null;
  now: Date;
}) {
  // The page text keeps one line per block.
  const paragraphs = savedText?.text.split("\n").filter((line) => line.trim() !== "") ?? [];
  return (
    <section aria-label="Link status" className="flex flex-col gap-2 print:hidden">
      <p className="flex items-start gap-2.5 rounded-lg bg-danger-soft px-4 py-3 typescale-body-md text-on-danger-soft">
        <Unlink className="mt-0.5 size-5 shrink-0" />
        <span>
          This link seems dead since{" "}
          <time dateTime={deadSince}>{formatAbsoluteDate(deadSince, now)}</time>. The page
          didn&apos;t answer in the last few weekly checks.
        </span>
      </p>
      {savedText && paragraphs.length > 0 ? (
        <Disclosure title="Read the saved text">
          <p className="pb-2 typescale-label-md text-ink-faint">
            As it was on{" "}
            <time dateTime={savedText.fetchedAt}>
              {formatAbsoluteDate(savedText.fetchedAt, now)}
            </time>
          </p>
          <div className="flex max-w-reading flex-col gap-3 typescale-body-md">
            {paragraphs.map((paragraph, index) => (
              <p key={index} className="text-pretty">
                {paragraph}
              </p>
            ))}
          </div>
        </Disclosure>
      ) : null}
    </section>
  );
}
