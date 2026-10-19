"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { RouterProvider } from "react-aria-components";

import { ToastRegion } from "@clippings/ui";

import { DeletedClippingsProvider } from "./clippings/deleted-clippings.tsx";
import { NewClippingProvider } from "./clippings/new-clipping-dialog.tsx";
import { CommandPalette } from "./command/command-palette.tsx";
import { LinkDrop } from "./command/link-drop.tsx";

declare module "react-aria-components" {
  interface RouterConfig {
    // React Aria links pass `routerOptions` through, so a link can name its transition types.
    routerOptions: NonNullable<Parameters<ReturnType<typeof useRouter>["push"]>[1]>;
  }
}

/**
 * What every signed-in page shares: React Aria links navigate through the Next.js router, URL
 * state reads and writes through nuqs, deletes are hidden everywhere at once, "New clipping", ⌘K
 * and a dropped link work on every page, and toasts outlive navigation.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <NuqsAdapter>
      <RouterProvider navigate={(href, options) => router.push(href as Route, options)}>
        <DeletedClippingsProvider>
          <NewClippingProvider>
            {children}
            <CommandPalette />
            <LinkDrop />
            <ToastRegion />
          </NewClippingProvider>
        </DeletedClippingsProvider>
      </RouterProvider>
    </NuqsAdapter>
  );
}
