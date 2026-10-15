"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon, cn, type IconName } from "@clippings/ui";

const matches = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

export function NavLink({ href, icon, label }: { href: Route; icon: IconName; label: string }) {
  const active = matches(usePathname(), href);

  return (
    <Link
      href={href}
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
