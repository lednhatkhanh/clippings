"use client";

import { ProgressBar as AriaProgressBar } from "react-aria-components";

import { cn } from "../cn.ts";

export interface ProgressBarProps {
  /** What is in progress, for screen readers. */
  label: string;
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

/** A linear bar for work of unknown length: one soft bar glides across the track. */
export function ProgressBar({ label, className }: ProgressBarProps) {
  return (
    <AriaProgressBar
      aria-label={label}
      isIndeterminate
      className={cn("progress-track block h-1 w-full rounded-full bg-line", className)}
    >
      <div className="progress-glide bg-accent" />
    </AriaProgressBar>
  );
}
