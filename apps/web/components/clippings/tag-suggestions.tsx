"use client";

import { Plus, X } from "lucide-react";
import { Button as AriaButton } from "react-aria-components";

import { Button } from "@clippings/ui";

/**
 * The tags enrichment suggests, as a quiet row under the tag editor: each chip shows a plus and
 * its name, one press adds it, and its own × dismisses it. Nothing is added unasked, and the
 * chips never look like the user's own tags (dashed, with no color).
 */
export function TagSuggestions({
  names,
  isDisabled,
  onAccept,
  onDismiss,
  onDismissAll,
}: {
  /** The suggestions still on offer. */
  names: readonly string[];
  isDisabled: boolean;
  onAccept: (name: string) => void;
  onDismiss: (name: string) => void;
  onDismissAll: () => void;
}) {
  if (names.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="typescale-label-md text-ink-muted">Suggested</span>
      {names.map((name) => (
        <span
          key={name}
          className="inline-flex items-center rounded-sm border border-dashed border-line-strong"
        >
          <AriaButton
            aria-label={`Add tag ${name}`}
            isDisabled={isDisabled}
            onPress={() => onAccept(name)}
            className="state-layer flex min-h-11 min-w-0 items-center gap-1 rounded-s-sm ps-2 pe-1.5 typescale-label-md text-ink data-disabled:opacity-40 medium:min-h-8"
          >
            <Plus className="size-3.5 shrink-0" />
            <span className="truncate">{name}</span>
          </AriaButton>
          <AriaButton
            aria-label={`Dismiss suggestion ${name}`}
            isDisabled={isDisabled}
            onPress={() => onDismiss(name)}
            className="state-layer flex size-11 shrink-0 items-center justify-center rounded-e-sm text-ink-faint data-disabled:opacity-40 medium:size-8"
          >
            <X className="size-3.5" />
          </AriaButton>
        </span>
      ))}
      {names.length > 1 ? (
        <Button variant="text" isDisabled={isDisabled} onPress={onDismissAll}>
          Dismiss all
        </Button>
      ) : null}
    </div>
  );
}
