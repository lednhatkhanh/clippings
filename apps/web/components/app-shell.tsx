import type { ReactNode } from "react";

import { AppNav } from "./app-nav.tsx";
import { OfflineBanner } from "./online-status.tsx";

/**
 * The frame every signed-in page sits in: glass navigation that floats over the page's color
 * fields (see `AppNav` for its three sizes), and room around the content for it. Each page brings
 * its own `PageHeader`, which is glass too.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh text-ink medium:ps-25 medium:pe-3 large:ps-69 print:ps-0">
      <a
        href="#main"
        className="sr-only rounded-full glass-float px-6 py-3 typescale-label-lg text-ink focus-visible:not-sr-only focus-visible:fixed focus-visible:start-4 focus-visible:top-4 focus-visible:z-50 print:hidden"
      >
        Skip to content
      </a>

      <AppNav />
      <OfflineBanner />

      {/* Compact pages clear the floating header; from medium the header is part of the page. */}
      <main id="main" className="px-3 pt-20 pb-32 medium:px-0 medium:pt-3 medium:pb-8 print:p-0">
        {children}
      </main>
    </div>
  );
}
