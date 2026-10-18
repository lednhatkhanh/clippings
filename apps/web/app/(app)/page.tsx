import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { ClippingList } from "@/components/clippings/clipping-list.tsx";
import { EmptyState } from "@/components/clippings/empty-state.tsx";
import { ListSkeleton } from "@/components/clippings/list-skeleton.tsx";
import { NewClippingDialog } from "@/components/clippings/new-clipping-dialog.tsx";
import { LoadError } from "@/components/load-error.tsx";
import { getSession } from "@/lib/auth/session.ts";
import { loadRows } from "@/lib/clippings/rows.ts";

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
  // Keyed by the first page, so a save, delete or Undo remounts the list with the server's rows.
  const firstPage = rows.map((row) => row.id).join();
  return <ClippingList key={firstPage} initialRows={rows} initialCursor={nextCursor} />;
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
