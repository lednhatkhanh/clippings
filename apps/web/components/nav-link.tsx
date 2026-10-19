"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { Icon, cn, type IconName } from "@clippings/ui";

/** The list owns its detail pages (`/c/[id]`), so "Clippings" stays marked on them. */
const matches = (pathname: string, href: string) =>
  href === "/"
    ? pathname === "/" || pathname.startsWith("/c/")
    : pathname === href || pathname.startsWith(`${href}/`);

interface NavLinkProps {
  href: Route;
  icon: IconName;
  label: string;
}

function NavLinkView({ href, icon, label, active }: NavLinkProps & { active: boolean }) {
  return (
    <Link
      href={href}
      transitionTypes={["nav-top"]}
      aria-current={active ? "page" : undefined}
      data-active={active ? "" : undefined}
      className={cn(
        "group state-layer flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-lg py-3 text-on-surface-variant",
        "medium:py-1",
        "large:h-14 large:flex-row large:justify-start large:gap-3 large:rounded-full large:px-4 large:py-0",
        "data-active:text-on-surface large:data-active:bg-secondary-container large:data-active:text-on-secondary-container",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-16 items-center justify-center rounded-full",
          "group-data-active:bg-secondary-container group-data-active:text-on-secondary-container",
          "large:h-auto large:w-auto large:group-data-active:bg-transparent",
        )}
      >
        <Icon name={icon} filled={active} />
      </span>
      <span className="typescale-label-md large:typescale-label-lg">{label}</span>
    </Link>
  );
}

function CurrentNavLink(props: NavLinkProps) {
  return <NavLinkView {...props} active={matches(usePathname(), props.href)} />;
}

/**
 * A destination in the navigation, marked when it is the current page. On a route with a dynamic
 * param the pathname is known only per request, so the prerendered shell shows the link unmarked.
 */
export function NavLink(props: NavLinkProps) {
  return (
    <Suspense fallback={<NavLinkView {...props} active={false} />}>
      <CurrentNavLink {...props} />
    </Suspense>
  );
}
