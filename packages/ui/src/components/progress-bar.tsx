"use client";

import { ProgressBar as AriaProgressBar } from "react-aria-components";

import { cn } from "../cn";

export interface ProgressBarProps {
  /** What is in progress, for screen readers. */
  label: string;
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

/** A linear bar for work of unknown length. */
export function ProgressBar({ label, className }: ProgressBarProps) {
  return (
    <AriaProgressBar
      aria-label={label}
      isIndeterminate
      className={cn(
        "block h-1 w-full overflow-hidden rounded-full bg-secondary-container",
        className,
      )}
    >
      <div className="h-full w-2/5 progress-sweep rounded-full bg-primary" />
    </AriaProgressBar>
  );
}
