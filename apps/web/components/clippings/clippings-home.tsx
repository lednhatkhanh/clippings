import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { LoadError } from "@/components/load-error.tsx";
import {
  PageTransition,
  RevealTransition,
  SkeletonTransition,
} from "@/components/page-transition.tsx";
import { getSession, signInRedirect } from "@/lib/auth/session.ts";
import { loadBrowseParams, toQueryString } from "@/lib/clippings/browse-params.ts";
import { loadRows } from "@/lib/clippings/rows.ts";

import { ClippingsBrowser } from "./clippings-browser.tsx";
import { EmptyState } from "./empty-state.tsx";
import { ListSkeleton } from "./list-skeleton.tsx";
import { NewClippingDialog } from "./new-clipping-dialog.tsx";

type SearchParams = PageProps<"/">["searchParams"];

async function Clippings({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (!session) redirect(await signInRedirect());
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

/**
 * The list of clippings under its heading and "New clipping": the home page, and what a share
 * opens over. `searchParams` holds the list's `?q=`, `source=` and `sort=`.
 */
export function ClippingsHome({ searchParams }: { searchParams: SearchParams }) {
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
