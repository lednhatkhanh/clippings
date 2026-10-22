import { CalendarDays } from "lucide-react";
import Link from "next/link";

import { Favicon } from "@/components/clippings/favicon.tsx";
import { domainOf } from "@/lib/clippings/rows.ts";
import { formatWeekRange } from "@/lib/digest/week-range.ts";
import type { DigestClippingRef, WeeklyDigestView } from "@clippings/db";
import { ClippingsStackIllustration } from "@clippings/ui";

function ClippingLink({ clipping }: { clipping: DigestClippingRef }) {
  return (
    <Link
      href={`/c/${clipping.id}`}
      className="flex lift items-center gap-3 rounded-md paper px-3.5 py-3"
    >
      <Favicon url={clipping.url} />
      <span className="flex min-w-0 flex-col gap-row-gap">
        <span className="truncate typescale-clipping-title">{clipping.title}</span>
        <span className="typescale-label-sm font-mono text-ink-faint">
          {domainOf(clipping.url)}
        </span>
      </span>
    </Link>
  );
}

/** Shown until the daily cron has written a digest for the user. */
export function DigestEmptyState() {
  return (
    <section className="mx-auto flex flex-col items-center gap-4 rounded-xl paper px-6 py-12 text-center">
      <ClippingsStackIllustration className="h-auto w-50" />
      <h2 className="typescale-title-lg">No digest yet</h2>
      <p className="max-w-100 typescale-body-md text-ink-muted">
        Each week you save pages, a summary of the week arrives here on the Monday after
      </p>
    </section>
  );
}

/** One week's digest: its groups, the older clippings it brings back, and where to find the other weeks. */
export function DigestView({
  digest,
  earlierWeeks,
}: {
  digest: WeeklyDigestView;
  earlierWeeks: readonly { weekStart: string; weekEnd: string }[];
}) {
  const range = formatWeekRange(digest.weekStart, digest.weekEnd);
  return (
    <div className="flex flex-col gap-6">
      <h2 className="flex items-center gap-2 typescale-label-sm tracking-widest text-ink-faint uppercase">
        <CalendarDays aria-hidden="true" className="size-4" />
        Week of {range}
      </h2>

      {digest.groups.length === 0 ? (
        <p className="typescale-body-md text-ink-muted">
          The clippings of this week are gone, so there is nothing left to show.
        </p>
      ) : (
        digest.groups.map((group) => (
          <section
            key={group.clippings[0]!.id}
            aria-label={group.title}
            className="flex flex-col gap-3 rounded-xl paper p-5"
          >
            <div className="flex flex-col gap-1">
              <h3 className="typescale-title-lg">{group.title}</h3>
              <p className="typescale-body-md text-ink-muted">{group.summary}</p>
            </div>
            <ul className="flex flex-col gap-2.5">
              {group.clippings.map((clipping) => (
                <li key={clipping.id}>
                  <ClippingLink clipping={clipping} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {digest.resurfaced.length > 0 ? (
        <section aria-labelledby="archive-heading" className="flex flex-col gap-3">
          <h2
            id="archive-heading"
            className="typescale-label-sm tracking-widest text-ink-faint uppercase"
          >
            From your archive
          </h2>
          <ul className="flex flex-col gap-4">
            {digest.resurfaced.map(({ clipping, why }) => (
              <li key={clipping.id} className="flex flex-col gap-1.5">
                <ClippingLink clipping={clipping} />
                <p className="px-1 typescale-body-md text-ink-muted">{why}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {earlierWeeks.length > 0 ? (
        <nav aria-labelledby="earlier-heading" className="flex flex-col gap-3">
          <h2
            id="earlier-heading"
            className="typescale-label-sm tracking-widest text-ink-faint uppercase"
          >
            Earlier weeks
          </h2>
          <ul className="flex flex-col gap-1">
            {earlierWeeks.map(({ weekStart, weekEnd }) => (
              <li key={weekStart}>
                <Link
                  href={{ pathname: "/digest", query: { week: weekStart } }}
                  className="state-layer flex min-h-11 items-center rounded-md px-3.5 typescale-body-md"
                >
                  {formatWeekRange(weekStart, weekEnd)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
