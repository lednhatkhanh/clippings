import { Check } from "lucide-react";

/** How an autosaving field stands. */
export type SaveState = "idle" | "saving" | "saved" | "failed";

/**
 * An autosaving field's status. An <output> is a polite live region, so it is announced without
 * moving focus. "Saved" gets the check that pops in (one of the two pops); a failure is the one
 * state in the danger color.
 */
export function SaveStatus({ state, text }: { state: SaveState; text: string }) {
  return (
    <output
      aria-live="polite"
      className={
        state === "failed"
          ? "flex min-h-5 items-center gap-1.5 typescale-label-sm text-danger"
          : "flex min-h-5 items-center gap-1.5 typescale-label-sm text-ink-faint"
      }
    >
      {state === "saved" ? <Check className="size-3.5 saved-pop text-accent-ink" /> : null}
      {text}
    </output>
  );
}
