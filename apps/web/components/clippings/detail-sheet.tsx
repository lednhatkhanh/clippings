"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import { SheetTransition } from "@/components/page-transition.tsx";

/** The paper sheet a clipping is read on. */
export function Sheet({ children }: { children: ReactNode }) {
  return (
    <article className="mx-auto w-fit max-w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-6 medium:p-12">
      {/* The reading measure is set in the reading type, so 66ch means 66 of its characters. */}
      <div className="w-reading max-w-full typescale-reading">{children}</div>
    </article>
  );
}

/**
 * The detail page's sheet, named for the clipping in the URL. The router knows the id before the
 * server answers, so the sheet is on screen when a navigation commits and the list row's sheet can
 * morph into it. On the server the id is known only per request: wrap it in Suspense.
 */
export function DetailSheet({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  return (
    <SheetTransition clippingId={id} direction="in">
      <Sheet>{children}</Sheet>
    </SheetTransition>
  );
}
