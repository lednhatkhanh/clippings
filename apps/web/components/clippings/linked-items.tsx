import { Link2 } from "lucide-react";
import Link from "next/link";

import { domainOf } from "@/lib/clippings/rows.ts";
import type { LinkedClipping } from "@clippings/db";

import { Favicon } from "./favicon.tsx";
import { NoteMark } from "./note-mark.tsx";

/**
 * The clippings and notes this one is linked to, each with the one line on why they belong
 * together. Nothing while there are none.
 */
export function LinkedItems({ links }: { links: readonly LinkedClipping[] }) {
  if (links.length === 0) return null;
  return (
    <section aria-labelledby="linked-heading" className="flex flex-col gap-2.5 print:hidden">
      <h2
        id="linked-heading"
        className="flex items-center gap-1.5 typescale-label-sm tracking-widest text-ink-faint uppercase"
      >
        <Link2 className="size-3.5" />
        Linked
      </h2>
      <ul className="flex flex-col gap-2.5">
        {links.map((link) => (
          <li key={link.linkId}>
            <Link
              href={`/c/${link.id}`}
              className="flex lift items-start gap-3 rounded-md paper px-3.5 py-3"
            >
              <span className="pt-0.5">
                {link.url === null ? <NoteMark /> : <Favicon url={link.url} />}
              </span>
              <span className="flex min-w-0 flex-col gap-row-gap">
                <span className="truncate typescale-clipping-title">{link.title}</span>
                <span className="typescale-label-sm font-mono text-ink-faint">
                  {link.url === null ? "Note" : domainOf(link.url)}
                </span>
                <span className="typescale-body-md text-pretty text-ink-muted">{link.reason}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
