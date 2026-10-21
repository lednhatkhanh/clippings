"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import { SheetTransition } from "@/components/page-transition.tsx";

/** The paper sheet a clipping is read on. */
export function Sheet({ children }: { children: ReactNode }) {
  return (
    <article className="mx-auto w-full max-w-180 rounded-xl paper p-5 medium:p-7 print:rounded-none print:bg-none print:p-0 print:shadow-none">
      {children}
    </article>
  );
}

/**
 * The detail page's sheet, named for the clipping in the URL. The router knows the id before the
 * server answers, so the sheet is on screen when a navigation commits and the list row's paper can
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
