import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { ListSkeleton } from "@/components/clippings/list-skeleton.tsx";
import { DigestEmptyState, DigestView } from "@/components/digest/digest-view.tsx";
import { LoadError } from "@/components/load-error.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import {
  PageTransition,
  RevealTransition,
  SkeletonTransition,
} from "@/components/page-transition.tsx";
import { getSession, signInRedirect } from "@/lib/auth/session.ts";
import { getDigests } from "@/lib/digest/service.ts";

async function Digest({ searchParams }: Pick<PageProps<"/digest">, "searchParams">) {
  const session = await getSession();
  if (!session) redirect(await signInRedirect());
  const { week } = await searchParams;
  // `?week=` is a week's Monday; anything else, or a repeated key, is no week of theirs.
  if (week !== undefined && typeof week !== "string") notFound();

  let loaded: Awaited<ReturnType<typeof load>>;
  try {
    loaded = await load(session.user.id, week);
  } catch (error) {
    unstable_rethrow(error);
    return <LoadError message="Couldn't load your digest." />;
  }

  if (!loaded) {
    // No digest at all is the empty page; a week they have none of is a missing one.
    if (week !== undefined) notFound();
    return <DigestEmptyState />;
  }
  return <DigestView digest={loaded.digest} earlierWeeks={loaded.earlierWeeks} />;
}

/** The digest asked for (the latest by default) and the user's other weeks. Null when there is none. */
async function load(userId: string, week: string | undefined) {
  const digests = getDigests();
  const [digest, weeks] = await Promise.all([
    digests.getDigest(userId, week),
    digests.listDigestWeeks(userId),
  ]);
  if (!digest) return null;
  return { digest, earlierWeeks: weeks.filter(({ weekStart }) => weekStart !== digest.weekStart) };
}

export default function DigestPage({ searchParams }: PageProps<"/digest">) {
  return (
    <PageTransition>
      <div className="mx-auto max-w-220 pb-4">
        <PageHeader title="This week" eyebrow="Your digest" />
        <Suspense
          fallback={
            <SkeletonTransition>
              <ListSkeleton />
            </SkeletonTransition>
          }
        >
          <RevealTransition>
            <Digest searchParams={searchParams} />
          </RevealTransition>
        </Suspense>
      </div>
    </PageTransition>
  );
}
