import { ExternalLink } from "lucide-react";

import { AiWritten } from "@/components/ai-written.tsx";
import { Markdown } from "@/components/markdown.tsx";
import { domainOf } from "@/lib/clippings/rows.ts";
import { linkableSources } from "@/lib/research/sources.ts";
import type { Brief } from "@clippings/shared";

import { BriefRequestButton } from "./brief-request-button.tsx";
import { RefreshWhileWriting } from "./refresh-while-writing.tsx";

const SECTION = "flex flex-col gap-4 rounded-xl paper p-5 medium:p-6 print:hidden";

/**
 * The research brief of a clipping, on paper under it: the brief with its sources once written,
 * where it stands while it isn't, and a quiet way to ask for one when there is none.
 */
export function ResearchBrief({
  clippingId,
  brief,
  now,
}: {
  clippingId: string;
  /** Null when the clipping has none. */
  brief: Brief | null;
  now: Date;
}) {
  if (!brief) {
    return (
      <section aria-label="Research brief" className="flex print:hidden">
        <BriefRequestButton clippingId={clippingId} variant="text">
          Research this
        </BriefRequestButton>
      </section>
    );
  }

  if (brief.status === "ready" && brief.body !== null) {
    const sources = linkableSources(brief.sources);
    return (
      <section aria-labelledby="brief-heading" className={SECTION}>
        <header className="flex flex-col gap-2">
          <h2 id="brief-heading" className="typescale-headline-sm">
            Research brief
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 typescale-label-md text-ink-faint">
            <AiWritten updatedAt={brief.updatedAt} now={now} />
            {brief.domain ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{brief.domain}</span>
              </>
            ) : null}
          </p>
        </header>
        <Markdown source={brief.body} links="web" />
        {sources.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <h3 className="typescale-label-sm tracking-widest text-ink-faint uppercase">Sources</h3>
            <ul className="flex flex-col gap-1.5">
              {sources.map((source) => (
                <li key={source.url} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 typescale-body-md underline underline-offset-2"
                  >
                    <span className="wrap-anywhere">{source.title}</span>
                    <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                  <span className="typescale-label-sm font-mono text-ink-faint">
                    {domainOf(source.url)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="typescale-body-sm text-ink-faint">
          The model wrote this brief from the web and may have it wrong. Check the sources.
        </p>
      </section>
    );
  }

  if (brief.status === "queued") {
    return (
      <section aria-label="Research brief" className={SECTION}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <p className="typescale-body-md text-ink-muted">
            Queued for tonight&rsquo;s research batch{brief.domain ? ` · ${brief.domain}` : ""}
          </p>
          <BriefRequestButton clippingId={clippingId}>Write it now</BriefRequestButton>
        </div>
        {brief.note ? <p className="typescale-body-sm text-ink-faint">{brief.note}</p> : null}
      </section>
    );
  }

  if (brief.status === "dropped") {
    return (
      <section aria-label="Research brief" className={SECTION}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <p className="typescale-body-md text-ink-muted">
            {brief.note ?? "The research brief couldn't be written."}
          </p>
          <BriefRequestButton clippingId={clippingId}>Try again now</BriefRequestButton>
        </div>
      </section>
    );
  }

  // A ready brief without a body is not a brief.
  if (brief.status === "ready") return null;

  // Submitted (in the overnight batch) or writing (now): only the second is worth watching.
  return (
    <section aria-label="Research brief" className={SECTION}>
      <p className="typescale-body-md text-ink-muted">Being written&hellip;</p>
      {brief.status === "writing" ? <RefreshWhileWriting /> : null}
    </section>
  );
}
