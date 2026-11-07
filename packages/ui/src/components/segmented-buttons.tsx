"use client";

import type { LucideIcon } from "lucide-react";
import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";

import { cn } from "../cn.ts";

/**
 * Records the segment whose chip shows now and returns the one before it, so the new chip can
 * slide over from there.
 */
type SwapSelected = (segment: HTMLElement) => HTMLElement | null;

const SwapSelectedContext = createContext<SwapSelected | null>(null);

export interface SegmentedButtonsProps {
  /** The `id` of the selected `Segment`. */
  selectedKey: string;
  onSelectionChange: (key: string) => void;
  "aria-label": string;
  /** Two to five `Segment`s. */
  children: ReactNode;
  isDisabled?: boolean;
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

/**
 * Segmented buttons with a single, always-present selection: a well, and a paper chip that
 * slides to the selected segment.
 */
export function SegmentedButtons({
  selectedKey,
  onSelectionChange,
  className,
  children,
  ...props
}: SegmentedButtonsProps) {
  const [swapSelected] = useState<SwapSelected>(() => {
    let last: HTMLElement | null = null;
    return (segment: HTMLElement) => {
      const previous = last;
      last = segment;
      return previous;
    };
  });
  return (
    <ToggleButtonGroup
      {...props}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[selectedKey]}
      onSelectionChange={(keys) => {
        const [key] = keys;
        if (typeof key === "string") onSelectionChange(key);
      }}
      className={cn("flex w-full gap-0.5 rounded-md bg-ground-sunk p-0.75 shadow-well", className)}
    >
      <SwapSelectedContext value={swapSelected}>{children}</SwapSelectedContext>
    </ToggleButtonGroup>
  );
}

/**
 * The paper chip behind the selected segment. It slides from the previously selected segment,
 * measured within the group rather than the viewport: a selection often changes the layout around
 * the group too (the New clipping form grows when Note is picked, so its sheet rises), and
 * React Aria's `SelectionIndicator` would carry that move into the slide as a vertical drift.
 */
function SegmentChip() {
  const ref = useRef<HTMLSpanElement>(null);
  const swapSelected = useContext(SwapSelectedContext);

  useLayoutEffect(() => {
    const chip = ref.current;
    const segment = chip?.parentElement;
    if (!chip || !segment || !swapSelected) return;
    const previous = swapSelected(segment);
    if (!previous?.isConnected || previous === segment) return;

    // Both segments share an offset parent, so their offsets compare within the group. The chip
    // sits at the inline start, which is the right edge in a right-to-left layout.
    const rtl = getComputedStyle(segment).direction === "rtl";
    const from = rtl ? previous.offsetLeft + previous.offsetWidth : previous.offsetLeft;
    const to = rtl ? segment.offsetLeft + segment.offsetWidth : segment.offsetLeft;
    chip.style.transitionProperty = "none";
    chip.style.translate = `${from - to}px 0`;
    chip.style.width = `${previous.offsetWidth}px`;
    // Commit the starting pose before handing back to the stylesheet's transition.
    chip.getBoundingClientRect();
    chip.style.removeProperty("transition-property");
    chip.style.removeProperty("translate");
    chip.style.removeProperty("width");
  }, [swapSelected]);

  return (
    <span
      ref={ref}
      aria-hidden
      className="absolute inset-y-0 start-0 -z-10 w-full segment-indicator rounded-sm paper"
    />
  );
}

export interface SegmentProps {
  /** The key `SegmentedButtons` selects by. */
  id: string;
  children: ReactNode;
  /** A leading icon, such as `icon={Sun}`. */
  icon?: LucideIcon;
  isDisabled?: boolean;
}

export function Segment({ children, icon: IconComponent, ...props }: SegmentProps) {
  return (
    <ToggleButton
      {...props}
      className="relative isolate flex h-10 min-w-0 flex-auto items-center justify-center gap-2 rounded-sm px-3 typescale-label-lg text-ink-muted transition-colors data-disabled:opacity-40 data-focus-visible:z-10 data-hovered:text-ink data-selected:text-ink medium:h-8.5"
    >
      {({ isSelected }) => (
        <>
          {isSelected ? <SegmentChip /> : null}
          {IconComponent ? <IconComponent className="size-4" /> : null}
          <span className="truncate">{children}</span>
        </>
      )}
    </ToggleButton>
  );
}
