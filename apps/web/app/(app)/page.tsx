import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { ClippingsBrowser } from "@/components/clippings/clippings-browser.tsx";
import { EmptyState } from "@/components/clippings/empty-state.tsx";
import { ListSkeleton } from "@/components/clippings/list-skeleton.tsx";
import { NewClippingDialog } from "@/components/clippings/new-clipping-dialog.tsx";
import { LoadError } from "@/components/load-error.tsx";
import {
  PageTransition,
  RevealTransition,
  SkeletonTransition,
} from "@/components/page-transition.tsx";
import { getSession } from "@/lib/auth/session.ts";
import { loadBrowseParams, toQueryString } from "@/lib/clippings/browse-params.ts";
import { loadRows } from "@/lib/clippings/rows.ts";

async function Clippings({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  // `?q=`, `source=` and `sort=` decide the first result, so a reload shows what was on screen.
  const params = await loadBrowseParams(searchParams);

  let page: Awaited<ReturnType<typeof loadRows>>;
  try {
    page = await loadRows(session.user.id, params);
  } catch (error) {
    unstable_rethrow(error);
    // Only the list is replaced, so the heading and "New clipping" stay in place.
    return <LoadError message="Couldn't load your clippings." />;
  }

  // Nothing saved yet: no search to offer.
  if (page.rows.length === 0 && !toQueryString(params)) return <EmptyState />;
  return <ClippingsBrowser initialParams={params} initialPage={page} />;
}

export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <PageTransition>
      <div className="mx-auto max-w-180">
        <div className="flex items-center justify-between gap-4 py-4">
          <h1 className="typescale-headline-sm">Clippings</h1>
          <NewClippingDialog />
        </div>
        <Suspense
          fallback={
            <SkeletonTransition>
              <ListSkeleton />
            </SkeletonTransition>
          }
        >
          <RevealTransition>
            <Clippings searchParams={searchParams} />
          </RevealTransition>
        </Suspense>
      </div>
    </PageTransition>
  );
}
