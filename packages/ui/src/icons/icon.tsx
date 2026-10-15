import type { ComponentProps } from "react";

import { cn } from "../cn";
import type { IconName } from "./icon-names";

export interface IconProps extends Omit<ComponentProps<"span">, "children"> {
  name: IconName;
  /** Filled variant, used for the selected navigation destination. */
  filled?: boolean;
}

/** Decorative by default: pair it with visible text or an `aria-label` on its button. */
export function Icon({ name, filled = false, className, ...props }: IconProps) {
  return (
    <span
      aria-hidden="true"
      data-filled={filled ? "" : undefined}
      className={cn("icon", className)}
      {...props}
    >
      {name}
    </span>
  );
}
