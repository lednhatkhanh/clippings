"use client";

import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { LinkRenderProvider, type LinkRender } from "@clippings/ui";

/**
 * Whether the router should prefetch this link: a page of the app, not a download, an API route
 * (prefetching `/api/export` would run the export) or another site.
 */
export function isPrefetchableHref(href: string, download: unknown): boolean {
  if (download !== undefined && download !== false) return false;
  return href.startsWith("/") && !href.startsWith("//") && !/^\/api(\/|$|\?)/.test(href);
}

// React Aria handles the click first (through `RouterProvider`, with the link's transition types)
// and marks it handled, so Next's `<Link>` only prefetches: in the viewport, then on hover.
const renderLink: LinkRender = (props) => {
  if (!("href" in props) || !props.href) {
    return <span {...(props as React.JSX.IntrinsicElements["span"])} />;
  }
  if (!isPrefetchableHref(props.href, props.download)) {
    const { children, ...anchorProps } = props;
    return <a {...anchorProps}>{children}</a>;
  }
  return <Link {...props} href={props.href as Route} />;
};

/** Design-system links (`LinkButton`, tag chips) render as Next's `<Link>`, so they prefetch. */
export function NextLinks({ children }: { children: ReactNode }) {
  return <LinkRenderProvider render={renderLink}>{children}</LinkRenderProvider>;
}
