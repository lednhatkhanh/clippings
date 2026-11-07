import { constructNow } from "date-fns";
import { ChevronLeft } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { AiWritten } from "@/components/ai-written.tsx";
import { ListSkeleton } from "@/components/clippings/list-skeleton.tsx";
import { LoadError } from "@/components/load-error.tsx";
import { Markdown } from "@/components/markdown.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import {
  PageTransition,
  RevealTransition,
  SkeletonTransition,
} from "@/components/page-transition.tsx";
import { getSession, signInRedirect } from "@/lib/auth/session.ts";
import { hrefWithFolder, hrefWithTag, loadBrowseParams } from "@/lib/clippings/browse-params.ts";
import { getLibrary } from "@/lib/librarian/library.ts";
import type { TagTopic } from "@clippings/db";
import { LinkButton, TagDot } from "@clippings/ui";

/** The tag's name over the page, and what the page is: written by the librarian, not the user. */
async function Topic({ params }: Pick<PageProps<"/tags/[id]">, "params">) {
  const session = await getSession();
  if (!session) redirect(await signInRedirect());
  const { id } = await params;

  let topic: TagTopic | null;
  try {
    topic = await getLibrary().getTagTopic(session.user.id, id);
  } catch (error) {
    unstable_rethrow(error);
    return <LoadError message="Couldn't load this topic page." />;
  }
  if (!topic) notFound();
  const { tag, folder, clippingCount, page } = topic;
  const now = constructNow(undefined);
  const count = `${clippingCount} ${clippingCount === 1 ? "clipping" : "clippings"}`;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-4 rounded-xl paper p-5 medium:p-6">
        <header className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 typescale-headline-sm">
            <TagDot color={tag.color} showNone />
            <span className="min-w-0 wrap-anywhere">{tag.name}</span>
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 typescale-label-md text-ink-faint">
            {page ? (
              <>
                <AiWritten updatedAt={page.updatedAt} now={now} />
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span>{count}</span>
            {folder ? (
              <>
                <span aria-hidden="true">·</span>
                <Link
                  href={hrefWithFolder(folder.id) as Route}
                  className="underline underline-offset-2"
                >
                  {folder.name}
                </Link>
              </>
            ) : null}
          </p>
        </header>
        {page ? (
          <>
            <Markdown source={page.body} links="web" />
            <p className="typescale-body-sm text-ink-faint">
              The librarian wrote this page from your clippings and may have it wrong. Your own
              clippings are the source.
            </p>
          </>
        ) : (
          <p className="typescale-body-md text-ink-muted">
            The librarian has not written a page for this tag yet.
          </p>
        )}
        <LinkButton
          href={hrefWithTag(loadBrowseParams(""), tag.name)}
          variant="paper"
          className="self-start"
        >
          See the {count}
        </LinkButton>
      </section>
    </div>
  );
}

export default function TopicPage({ params }: PageProps<"/tags/[id]">) {
  return (
    <PageTransition>
      <div className="mx-auto flex max-w-180 flex-col gap-4 pb-4">
        <PageHeader
          title="Topic page"
          eyebrow="Your library"
          start={
            <Link
              href="/tags"
              transitionTypes={["nav-back"]}
              aria-label="Back to tags"
              className="state-layer flex size-11 items-center justify-center rounded-md text-ink"
            >
              <ChevronLeft className="size-5" />
            </Link>
          }
        />
        <LinkButton
          href="/tags"
          routerOptions={{ transitionTypes: ["nav-back"] }}
          className="hidden self-start medium:inline-flex"
        >
          <ChevronLeft className="size-4.5" />
          Tags
        </LinkButton>
        <Suspense
          fallback={
            <SkeletonTransition>
              <ListSkeleton />
            </SkeletonTransition>
          }
        >
          <RevealTransition>
            <Topic params={params} />
          </RevealTransition>
        </Suspense>
      </div>
    </PageTransition>
  );
}
