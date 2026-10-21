"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Disclosure as AriaDisclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";

import { cn } from "../cn.ts";

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
          className="state-layer flex min-h-11 w-full items-center gap-2 rounded-md ps-2 pe-3 text-start text-ink"
        >
          <ChevronDown className="size-4.5 -rotate-90 text-ink-muted transition-transform duration-snap ease-snap group-data-expanded:rotate-0 rtl:rotate-90 rtl:group-data-expanded:rotate-0" />
          {title}
        </AriaButton>
      </Heading>
      <DisclosurePanel className="disclosure-panel">
        <div className="px-2 pb-2">{children}</div>
      </DisclosurePanel>
    </AriaDisclosure>
  );
}
