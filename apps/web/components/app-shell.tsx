import type { ReactNode } from "react";

import { NavLink } from "./nav-link.tsx";
import { OfflineBanner } from "./online-status.tsx";

/**
 * Navigation by window size class, from one `<nav>`:
 * - compact (< 600px): bar fixed at the bottom;
 * - medium and expanded (600–1199px): collapsed 96px rail;
 * - large and up (≥ 1200px): expanded 240px rail.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface text-on-surface medium:ps-24 large:ps-60 print:ps-0">
      <a
        href="#main"
        className="sr-only rounded-full bg-primary px-6 py-3 typescale-label-lg text-on-primary focus-visible:not-sr-only focus-visible:fixed focus-visible:start-4 focus-visible:top-4 focus-visible:z-50 print:hidden"
      >
        Skip to content
      </a>

      {/* Named, so page transitions run beneath the header and navigation without moving them. */}
      <header className="sticky top-0 z-20 flex h-16 items-center bg-surface px-4 vt-anchored-header medium:px-6 large:px-8 print:hidden">
        <span className="typescale-title-lg">Clippings</span>
      </header>

      <OfflineBanner />

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 bg-surface-container pb-safe vt-anchored-nav medium:inset-y-0 medium:end-auto medium:w-24 medium:bg-surface medium:pb-0 large:w-60 print:hidden"
      >
        <ul className="flex h-20 items-stretch medium:h-auto medium:flex-col medium:gap-3 medium:px-3 medium:pt-20 large:px-4">
          <li className="flex flex-1 medium:flex-none">
            <NavLink href="/" icon="bookmarks" label="Clippings" />
          </li>
          <li className="flex flex-1 medium:flex-none">
            <NavLink href="/tags" icon="sell" label="Tags" />
          </li>
          <li className="flex flex-1 medium:flex-none">
            <NavLink href="/settings" icon="settings" label="Settings" />
          </li>
        </ul>
      </nav>

      <main id="main" className="px-4 pb-28 medium:px-6 medium:pb-8 large:px-8 print:p-0">
        {children}
      </main>
    </div>
  );
}
