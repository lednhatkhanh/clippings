import Link from "next/link";
import { unstable_rethrow } from "next/navigation";

import { domainOf } from "@/lib/clippings/rows.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import type { Clipping } from "@clippings/shared";

import { Favicon } from "./favicon.tsx";

/**
 * The user's clippings nearest in meaning to this one. Shows nothing while there are none, or when
 * they can't be loaded: the clipping itself is what the page is for.
 */
export async function RelatedClippings({
  userId,
  clippingId,
}: {
  userId: string;
  clippingId: string;
}) {
  let related: Clipping[];
  try {
    related = await getClippings().relatedClippings(userId, clippingId);
  } catch (error) {
    unstable_rethrow(error);
    console.error(`Couldn't load clippings related to ${clippingId}`, error);
    return null;
  }
  if (related.length === 0) return null;

  return (
    <section aria-labelledby="related-heading" className="flex flex-col gap-2">
      <h2 id="related-heading" className="typescale-title-md">
        Related
      </h2>
      <ul className="flex flex-col">
        {related.map((clipping) => (
          <li key={clipping.id}>
            <Link
              href={`/c/${clipping.id}`}
              className="state-layer flex items-center gap-3 rounded-sm px-2 py-row-block focus-visible:outline-solid"
            >
              <Favicon url={clipping.url} />
              <span className="flex min-w-0 flex-col gap-row-gap">
                <span className="truncate typescale-clipping-title">{clipping.title}</span>
                <span className="typescale-label-sm font-mono text-on-surface-variant">
                  {domainOf(clipping.url)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
