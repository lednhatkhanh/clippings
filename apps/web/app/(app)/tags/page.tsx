import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { ListSkeleton } from "@/components/clippings/list-skeleton.tsx";
import { LoadError } from "@/components/load-error.tsx";
import {
  PageTransition,
  RevealTransition,
  SkeletonTransition,
} from "@/components/page-transition.tsx";
import { TagsEmptyState } from "@/components/tags/empty-state.tsx";
import { TagList } from "@/components/tags/tag-list.tsx";
import { getSession } from "@/lib/auth/session.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import type { TagSummary } from "@clippings/shared";

async function Tags() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  let tags: TagSummary[];
  try {
    tags = await getClippings().listTagSummaries(session.user.id);
  } catch (error) {
    unstable_rethrow(error);
    return <LoadError message="Couldn't load your tags." />;
  }

  return tags.length === 0 ? <TagsEmptyState /> : <TagList tags={tags} />;
}

export default function TagsPage() {
  return (
    <PageTransition>
      <div className="mx-auto max-w-180">
        <h1 className="py-4 typescale-headline-sm">Tags</h1>
        <Suspense
          fallback={
            <SkeletonTransition>
              <ListSkeleton />
            </SkeletonTransition>
          }
        >
          <RevealTransition>
            <Tags />
          </RevealTransition>
        </Suspense>
      </div>
    </PageTransition>
  );
}
