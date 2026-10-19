"use client";

import { Button as AriaButton, Link as AriaLink } from "react-aria-components";
import type {
  ButtonProps as AriaButtonProps,
  LinkProps as AriaLinkProps,
} from "react-aria-components";

import { cn } from "../cn.ts";

const VARIANTS = {
  filled: "bg-primary text-on-primary",
  tonal: "bg-secondary-container text-on-secondary-container",
  outlined: "border border-outline text-primary",
  text: "text-primary",
} as const;

const BASE =
  "state-layer inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 outline-secondary typescale-label-lg transition disabled:opacity-38 data-pending:opacity-38";

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
