import { constructNow } from "date-fns";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { DeleteClippingButton } from "@/components/clippings/delete-clipping-button.tsx";
import { EnrichmentStatus } from "@/components/clippings/enrichment-status.tsx";
import { Favicon } from "@/components/clippings/favicon.tsx";
import { NoteEditor } from "@/components/clippings/note-editor.tsx";
import { LoadError } from "@/components/load-error.tsx";
import { getSession } from "@/lib/auth/session.ts";
import { domainOf } from "@/lib/clippings/rows.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import { SOURCE_LABELS } from "@/lib/clippings/source-labels.ts";
import { formatAbsoluteDate } from "@/lib/format-date.ts";
import type { Clipping, ClippingStatus } from "@clippings/shared";
import { Disclosure, Icon, LinkButton } from "@clippings/ui";

const STATUS_LABELS: Record<ClippingStatus, string> = {
  pending: "Pending: reading the page",
  ready: "Ready",
  failed: "Failed: couldn't read the page",
};

/** What was stored, as stored: for the curious and for checking what a client saved. */
function RawMetadata({ clipping }: { clipping: Clipping }) {
  const fields = [
    { term: "Normalized URL", value: clipping.urlNormalized, mono: true },
    { term: "Source", value: clipping.source, mono: true },
    { term: "Saved by client", value: clipping.clientId ?? "None (saved while signed in)" },
    { term: "Enrichment", value: STATUS_LABELS[clipping.status] },
  ];
  return (
    <Disclosure title="Details">
      <dl className="flex flex-col">
        {fields.map(({ term, value, mono }) => (
          <div key={term} className="flex flex-col gap-1 py-2">
            <dt className="typescale-label-md text-on-surface-variant">{term}</dt>
            <dd
              className={mono ? "typescale-body-md font-mono wrap-anywhere" : "typescale-body-md"}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  );
}

/** One of the user's clippings with its save date worded as of now, or null if they have none. */
async function loadClipping(userId: string, clippingId: string) {
  const clipping = await getClippings().getClipping(userId, clippingId);
  return clipping
    ? { clipping, savedOn: formatAbsoluteDate(clipping.createdAt, constructNow(undefined)) }
    : null;
}

async function ClippingDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { id } = await params;

  let loaded: Awaited<ReturnType<typeof loadClipping>>;
  try {
    loaded = await loadClipping(session.user.id, id);
  } catch (error) {
    unstable_rethrow(error);
    return <LoadError message="Couldn't load this clipping." />;
  }
  if (!loaded) notFound();
  const { clipping, savedOn } = loaded;

  return (
    <article className="mx-auto w-fit max-w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-6 medium:p-12">
      {/* The reading measure is set in the reading type, so 66ch means 66 of its characters. */}
      <div className="flex w-reading max-w-full flex-col gap-6 typescale-reading">
        <header className="flex flex-col gap-3">
          <h1 className="typescale-headline-sm text-balance wrap-anywhere">{clipping.title}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 typescale-label-md text-on-surface-variant">
            <Favicon url={clipping.url} />
            <span className="font-mono">{domainOf(clipping.url)}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={clipping.createdAt}>Saved {savedOn}</time>
            <span className="ms-1 inline-flex h-6 items-center rounded-sm border border-outline px-2 typescale-label-sm">
              <span className="sr-only">Source:&nbsp;</span>
              {SOURCE_LABELS[clipping.source]}
            </span>
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <LinkButton
            variant="filled"
            href={clipping.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="open_in_new" />
            Open original
            <span className="sr-only">(opens in a new tab)</span>
          </LinkButton>
          <DeleteClippingButton clippingId={clipping.id} />
        </div>

        {clipping.status === "ready" ? (
          clipping.summary ? (
            <p className="typescale-reading text-pretty">{clipping.summary}</p>
          ) : null
        ) : (
          <EnrichmentStatus clippingId={clipping.id} status={clipping.status} />
        )}

        <NoteEditor clippingId={clipping.id} note={clipping.note} />

        <RawMetadata clipping={clipping} />
      </div>
    </article>
  );
}

/** A sheet-shaped placeholder. It appears only after 150 ms, so a fast load shows nothing. */
function DetailSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto flex w-full appear-delayed flex-col gap-4 rounded-lg border border-outline-variant p-6 medium:max-w-180 medium:p-12"
    >
      <div className="h-8 w-4/5 rounded-xs bg-surface-container-high" />
      <div className="h-4 w-2/5 rounded-xs bg-surface-container-high" />
      <div className="h-24 w-full rounded-xs bg-surface-container-high" />
    </div>
  );
}

export default function ClippingPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex flex-col gap-2 py-4">
      <LinkButton href="/" className="self-start">
        <Icon name="arrow_back" />
        Clippings
      </LinkButton>
      <Suspense fallback={<DetailSkeleton />}>
        <ClippingDetail params={params} />
      </Suspense>
    </div>
  );
}
