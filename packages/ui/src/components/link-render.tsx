"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { LinkProps } from "react-aria-components";

export type LinkRender = NonNullable<LinkProps["render"]>;

const LinkRenderContext = createContext<LinkRender | undefined>(undefined);

/**
 * Renders every design-system link through the app's router link (Next's `<Link>`), so links
 * prefetch their page. React Aria still handles the click; without a provider a link is a plain
 * `<a>`.
 */
export function LinkRenderProvider({
  render,
  children,
}: {
  render: LinkRender;
  children: ReactNode;
}) {
  return <LinkRenderContext value={render}>{children}</LinkRenderContext>;
}

export function useLinkRender() {
  return useContext(LinkRenderContext);
}
