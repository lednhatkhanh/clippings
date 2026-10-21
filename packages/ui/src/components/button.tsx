"use client";

import { Button as AriaButton, Link as AriaLink } from "react-aria-components";
import type {
  ButtonProps as AriaButtonProps,
  LinkProps as AriaLinkProps,
} from "react-aria-components";

import { cn } from "../cn.ts";

// `filled` is the one accent action, `paper` the quiet alternative that lifts on hover, `text` a
// bare label, `danger` a destructive confirm. `tonal` and `outlined` are older names for `paper`.
const VARIANTS = {
  filled:
    "accent-fill transition duration-quick ease-settle data-hovered:brightness-105 data-hovered:saturate-105 data-pressed:translate-y-px data-pressed:brightness-95 data-pressed:duration-press",
  paper: "paper lift text-ink",
  tonal: "paper lift text-ink",
  outlined: "paper lift text-ink",
  text: "state-layer text-ink-muted transition-colors data-hovered:text-ink data-pressed:text-ink",
  danger:
    "bg-danger text-on-danger shadow-paper transition duration-quick ease-settle data-hovered:brightness-110 data-pressed:translate-y-px data-pressed:brightness-95 data-pressed:duration-press",
} as const;

const BASE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 typescale-label-lg data-disabled:opacity-40 data-pending:opacity-40 medium:h-10";

type Variant = keyof typeof VARIANTS;

export interface ButtonProps extends Omit<AriaButtonProps, "className"> {
  variant?: Variant;
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

export function Button({ variant = "filled", className, ...props }: ButtonProps) {
  return <AriaButton {...props} className={cn(BASE, VARIANTS[variant], className)} />;
}

export interface LinkButtonProps extends Omit<AriaLinkProps, "className"> {
  variant?: Variant;
  className?: string;
}

/** A link that looks like a button. */
export function LinkButton({ variant = "text", className, ...props }: LinkButtonProps) {
  return <AriaLink {...props} className={cn(BASE, VARIANTS[variant], className)} />;
}
