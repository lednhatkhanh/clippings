"use client";

import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Disclosure as AriaDisclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";

import { cn } from "../cn.ts";
import { Icon } from "../icons/icon.tsx";

export interface DisclosureProps {
  /** The trigger's text. */
  title: string;
  children: ReactNode;
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

/**
 * A section that opens from a heading-level trigger, closed to begin with. The panel grows to its
 * content and the chevron turns; find-in-page still opens it while closed.
 */
export function Disclosure({ title, children, className }: DisclosureProps) {
  return (
    <AriaDisclosure className={cn("group flex flex-col", className)}>
      <Heading className="typescale-title-sm">
        <AriaButton
          slot="trigger"
          className="state-layer flex min-h-12 w-full items-center gap-2 rounded-full ps-2 pe-4 text-start text-on-surface"
        >
          <span className="flex transition-transform duration-spatial-fast ease-spatial-fast group-data-expanded:rotate-90">
            <Icon name="chevron_right" />
          </span>
          {title}
        </AriaButton>
      </Heading>
      <DisclosurePanel className="disclosure-panel">
        <div className="px-2 pb-2">{children}</div>
      </DisclosurePanel>
    </AriaDisclosure>
  );
}
