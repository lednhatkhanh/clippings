import type { ComponentProps, ReactNode } from "react";

import { cn } from "../cn";

export type IllustrationProps = Omit<ComponentProps<"svg">, "children" | "viewBox">;

/**
 * Shared frame for the "ink and wash" illustrations: one line weight in `on-surface-variant`
 * and flat washes from the palette, so they re-tint with the palette, mode and contrast.
 * Decorative: pair them with visible text.
 */
export function Illustration({
  className,
  children,
  ...props
}: IllustrationProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 240 160"
      aria-hidden="true"
      fill="none"
      className={cn("text-on-surface-variant", className)}
      {...props}
    >
      {children}
    </svg>
  );
}

/** Line art: 1.5px, round caps and joins, constant weight at any size. */
export const ink = {
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  vectorEffect: "non-scaling-stroke",
} as const;
