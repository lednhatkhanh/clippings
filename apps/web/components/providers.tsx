"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { RouterProvider } from "react-aria-components";

import { ToastRegion } from "@clippings/ui";

import { DeletedClippingsProvider } from "./clippings/deleted-clippings";

/**
 * What every signed-in page shares: React Aria links navigate through the Next.js router, deletes
 * are hidden everywhere at once, and toasts outlive navigation.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <RouterProvider navigate={(href) => router.push(href as Route)}>
      <DeletedClippingsProvider>
        {children}
        <ToastRegion />
      </DeletedClippingsProvider>
    </RouterProvider>
  );
}
