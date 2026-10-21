"use client";

import type { LucideIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { cn } from "@clippings/ui";

import { sectionIndex, sectionTransitionType } from "./nav-sections.ts";

interface NavLinkProps {
  href: Route;
  icon: LucideIcon;
  label: string;
}

function NavLinkView({
  href,
  icon: IconComponent,
  label,
  pathname,
}: NavLinkProps & { pathname: string | null }) {
  const active = pathname !== null && sectionIndex(pathname) === sectionIndex(href);
  const type = pathname === null ? undefined : sectionTransitionType(pathname, href);

  return (
    <Link
      href={href}
      transitionTypes={type ? [type] : undefined}
      aria-current={active ? "page" : undefined}
      data-active={active ? "" : undefined}
      className={cn(
        "group state-layer flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-ink-muted transition-colors",
        "data-active:text-ink",
        // Collapsed rail: an icon in a 48px tile.
        "medium:size-12 medium:min-h-0 medium:flex-none",
        "medium:data-active:text-on-accent-soft",
        // Expanded rail: icon and label in a 44px row.
        "large:h-11 large:w-full large:flex-row large:justify-start large:gap-3 large:px-3.5",
      )}
    >
      <span className="relative flex h-7.5 w-14 items-center justify-center transition-colors group-data-active:text-on-accent-soft medium:static medium:h-auto medium:w-auto">
        {/* The highlight, behind the state layer: around the icon, or the whole link from medium. */}
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10 rounded-md bg-accent-soft nav-indicator"
        />
        <IconComponent className="size-5" />
      </span>
      <span className="typescale-label-sm medium:sr-only large:not-sr-only large:typescale-label-lg">
        {label}
      </span>
    </Link>
  );
}

function CurrentNavLink(props: NavLinkProps) {
  return <NavLinkView {...props} pathname={usePathname()} />;
}

/**
 * A destination in the navigation, marked when it is the current page. On a route with a dynamic
 * param the pathname is known only per request, so the prerendered shell shows the link unmarked.
 * A click adds the transition type for the move (see `sectionTransitionType`).
 */
export function NavLink(props: NavLinkProps) {
  return (
    <Suspense fallback={<NavLinkView {...props} pathname={null} />}>
      <CurrentNavLink {...props} />
    </Suspense>
  );
}
