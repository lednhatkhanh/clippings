import { constructNow } from "date-fns";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { ListSkeleton } from "@/components/clippings/list-skeleton.tsx";
import { LibraryReview, type ReviewItem } from "@/components/library/library-review.tsx";
import { LoadError } from "@/components/load-error.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import {
  PageTransition,
  RevealTransition,
  SkeletonTransition,
} from "@/components/page-transition.tsx";
import { getSession, signInRedirect } from "@/lib/auth/session.ts";
import { formatClippingDate } from "@/lib/format-date.ts";
import { summarizeChange } from "@/lib/librarian/describe.ts";
import { getLibrary } from "@/lib/librarian/library.ts";
import { getLibrarian } from "@/lib/librarian/service.ts";
import { LinkButton } from "@clippings/ui";

export const metadata: Metadata = { title: "Library review · Clippings" };

/** The most suggestions the screen lists at once. */
const SUGGESTION_LIMIT = 50;

async function Review() {
  const session = await getSession();
  if (!session) redirect(await signInRedirect());
  const userId = session.user.id;

  let suggestions: ReviewItem[];
  let applied: ReviewItem[];
  let moreWaiting: boolean;
  try {
    const [waiting, recent] = await Promise.all([
      getLibrarian().listSuggestions(userId, { limit: SUGGESTION_LIMIT }),
      getLibrary().listAppliedChanges(userId),
    ]);
    const now = constructNow(undefined);
    suggestions = waiting.items.map((change) => ({
      id: change.id,
      summary: summarizeChange(change),
      dateLabel: formatClippingDate(change.createdAt, now),
      dateTime: change.createdAt,
    }));
    applied = recent.map((change) => ({
      id: change.id,
      summary: summarizeChange(change),
      dateLabel: formatClippingDate(change.appliedAt, now),
      dateTime: change.appliedAt,
    }));
    moreWaiting = waiting.nextCursor !== null;
  } catch (error) {
    unstable_rethrow(error);
    return <LoadError message="Couldn't load the library review." />;
  }

  return <LibraryReview suggestions={suggestions} applied={applied} moreWaiting={moreWaiting} />;
}

export default function LibraryReviewPage() {
  return (
    <PageTransition>
      <div className="mx-auto flex max-w-220 flex-col gap-4 pb-4">
        <PageHeader
          title="Library review"
          eyebrow="Settings"
          start={
            <Link
              href="/settings"
              transitionTypes={["nav-back"]}
              aria-label="Back to settings"
              className="state-layer flex size-11 items-center justify-center rounded-md text-ink"
            >
              <ChevronLeft className="size-5" />
            </Link>
          }
        />
        <LinkButton
          href="/settings"
          routerOptions={{ transitionTypes: ["nav-back"] }}
          className="hidden self-start medium:inline-flex"
        >
          <ChevronLeft className="size-4.5" />
          Settings
        </LinkButton>
        <Suspense
          fallback={
            <SkeletonTransition>
              <ListSkeleton />
            </SkeletonTransition>
          }
        >
          <RevealTransition>
            <Review />
          </RevealTransition>
        </Suspense>
      </div>
    </PageTransition>
  );
}
