import { constructNow } from "date-fns";
import { ChevronLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { DeleteClippingButton } from "@/components/clippings/delete-clipping-button.tsx";
import { DetailSheet, Sheet } from "@/components/clippings/detail-sheet.tsx";
import { EnrichmentStatus } from "@/components/clippings/enrichment-status.tsx";
import { Favicon } from "@/components/clippings/favicon.tsx";
import { NoteEditor } from "@/components/clippings/note-editor.tsx";
import { RelatedClippings } from "@/components/clippings/related-clippings.tsx";
import { TagEditor } from "@/components/clippings/tag-editor.tsx";
import { LoadError } from "@/components/load-error.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import {
  PageTransition,
  RevealTransition,
  SkeletonTransition,
} from "@/components/page-transition.tsx";
import { getSession, signInRedirect } from "@/lib/auth/session.ts";
import { domainOf } from "@/lib/clippings/rows.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import { SOURCE_LABELS } from "@/lib/clippings/source-labels.ts";
import { formatAbsoluteDate, type Clipping, type ClippingStatus } from "@clippings/shared";
import { Disclosure, LinkButton } from "@clippings/ui";

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
    <div className="border-t border-line pt-1 print:hidden">
      <Disclosure title="Details">
        <dl className="flex flex-col">
          {fields.map(({ term, value, mono }) => (
            <div key={term} className="flex flex-col gap-1 py-2">
              <dt className="typescale-label-md text-ink-faint">{term}</dt>
              <dd
                className={mono ? "typescale-body-md font-mono wrap-anywhere" : "typescale-body-md"}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </div>
  );
}

/** One of the user's clippings with its save date worded as of now, or null if they have none. */
async function loadClipping(userId: string, clippingId: string) {
  const clipping = await getClippings().getClipping(userId, clippingId);
  return clipping
    ? { clipping, savedOn: formatAbsoluteDate(clipping.createdAt, constructNow(undefined)) }
    : null;
}

/** The clipping's text and actions, inside the sheet the page puts around it. */
async function ClippingDetail({ params }: Pick<PageProps<"/c/[id]">, "params">) {
  const session = await getSession();
  if (!session) redirect(await signInRedirect());
  const { id: clippingId } = await params;

  let loaded: Awaited<ReturnType<typeof loadClipping>>;
  try {
    loaded = await loadClipping(session.user.id, clippingId);
  } catch (error) {
    unstable_rethrow(error);
    return <LoadError message="Couldn't load this clipping." />;
  }
  if (!loaded) notFound();
  const { clipping, savedOn } = loaded;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2.5">
        <h1 className="typescale-headline-sm text-balance wrap-anywhere medium:typescale-headline-md">
          {clipping.title}
        </h1>
        {/* On paper there is no link to follow, so the address itself goes under the title. */}
        <p className="hidden typescale-body-md font-mono wrap-anywhere print:block">
          {clipping.url}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 typescale-label-md text-ink-faint">
          <Favicon url={clipping.url} size="inline" />
          <span className="font-mono">{domainOf(clipping.url)}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={clipping.createdAt}>Saved {savedOn}</time>
          <span className="inline-flex h-5.5 items-center rounded-sm border border-line-strong px-2 typescale-label-sm text-ink-muted">
            <span className="sr-only">Source:&nbsp;</span>
            {SOURCE_LABELS[clipping.source]}
          </span>
        </p>
      </header>

      <div className="flex items-center gap-2 print:hidden">
        <LinkButton
          variant="filled"
          href={clipping.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 medium:flex-none"
        >
          <ExternalLink className="size-4.5" />
          Open original
          <span className="sr-only">(opens in a new tab)</span>
        </LinkButton>
        <DeleteClippingButton clippingId={clipping.id} />
      </div>

      {clipping.status === "ready" ? (
        clipping.summary ? (
          <p className="max-w-reading typescale-reading text-pretty">{clipping.summary}</p>
        ) : null
      ) : (
        <EnrichmentStatus clippingId={clipping.id} status={clipping.status} />
      )}

      <TagEditor clippingId={clipping.id} tags={clipping.tags} />

      <NoteEditor clippingId={clipping.id} note={clipping.note} />

      <RawMetadata clipping={clipping} />
    </div>
  );
}

/** The neighbours, streamed after the sheet: finding them is a second query. */
async function Related({ params }: Pick<PageProps<"/c/[id]">, "params">) {
  const session = await getSession();
  if (!session) redirect(await signInRedirect());
  const { id } = await params;
  return <RelatedClippings userId={session.user.id} clippingId={id} />;
}

/** Text-shaped placeholders. They appear only after 150 ms, so a fast load shows nothing. */
function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex appear-delayed flex-col gap-4">
      <div className="h-8 w-4/5 skeleton-pulse rounded-xs bg-ground-sunk" />
      <div className="h-4 w-2/5 skeleton-pulse rounded-xs bg-ground-sunk" />
      <div className="h-11 w-full skeleton-pulse rounded-md bg-ground-sunk" />
      <div className="h-24 w-full skeleton-pulse rounded-xs bg-ground-sunk" />
    </div>
  );
}

export default function ClippingPage({ params }: PageProps<"/c/[id]">) {
  return (
    <PageTransition>
      <div className="mx-auto flex max-w-180 flex-col gap-4 pb-4">
        {/* On a phone the glass header carries the way back; wider, the link below does. */}
        <PageHeader
          title="Clipping"
          as="p"
          compactOnly
          start={
            <Link
              href="/"
              transitionTypes={["nav-back"]}
              aria-label="Back to clippings"
              className="state-layer flex size-11 items-center justify-center rounded-md text-ink"
            >
              <ChevronLeft className="size-5" />
            </Link>
          }
        />
        <LinkButton
          href="/"
          routerOptions={{ transitionTypes: ["nav-back"] }}
          className="hidden self-start medium:inline-flex print:hidden"
        >
          <ChevronLeft className="size-4.5" />
          Clippings
        </LinkButton>
        <Suspense
          fallback={
            <Sheet>
              <DetailSkeleton />
            </Sheet>
          }
        >
          <DetailSheet>
            <Suspense
              fallback={
                <SkeletonTransition>
                  <DetailSkeleton />
                </SkeletonTransition>
              }
            >
              <RevealTransition>
                <ClippingDetail params={params} />
              </RevealTransition>
            </Suspense>
          </DetailSheet>
        </Suspense>
        <Suspense>
          <RevealTransition>
            <Related params={params} />
          </RevealTransition>
        </Suspense>
      </div>
    </PageTransition>
  );
}
