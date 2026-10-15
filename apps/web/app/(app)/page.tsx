import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { ClippingList } from "../../components/clippings/clipping-list";
import { EmptyState } from "../../components/clippings/empty-state";
import { ListSkeleton } from "../../components/clippings/list-skeleton";
import { NewClippingDialog } from "../../components/clippings/new-clipping-dialog";
import { LoadError } from "../../components/load-error";
import { getSession } from "../../lib/auth/session";
import { loadRows } from "../../lib/clippings/rows";

async function Clippings() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  let page: Awaited<ReturnType<typeof loadRows>>;
  try {
    page = await loadRows(session.user.id);
  } catch (error) {
    unstable_rethrow(error);
    // Only the list is replaced, so the heading and "New clipping" stay in place.
    return <LoadError message="Couldn't load your clippings." />;
  }
  const { rows, nextCursor } = page;

  if (rows.length === 0) return <EmptyState />;
  // Keyed by the newest clipping, so a fresh save remounts the list with the new first page.
  return <ClippingList key={rows[0]?.id} initialRows={rows} initialCursor={nextCursor} />;
}

export default function HomePage() {
  return (
    <div className="mx-auto max-w-180">
      <div className="flex items-center justify-between gap-4 py-4">
        <h1 className="typescale-headline-sm">Clippings</h1>
        <NewClippingDialog />
      </div>
      <Suspense fallback={<ListSkeleton />}>
        <Clippings />
      </Suspense>
    </div>
  );
}
