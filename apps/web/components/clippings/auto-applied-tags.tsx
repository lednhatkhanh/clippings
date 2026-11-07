"use client";

import { Undo2 } from "lucide-react";
import { Button as AriaButton } from "react-aria-components";

/** A tag auto-tagging put on the clipping, as the detail page shows it. */
export interface AutoAppliedTagItem {
  changeId: string;
  name: string;
  /** Why the model chose it. */
  reason: string;
}

/**
 * The tags added automatically, as a quiet row under the tag editor: each says it was added by
 * the model, why, and offers a one-press Undo. The tags themselves are in the editor above, so
 * this row is only the receipt.
 */
export function AutoAppliedTags({
  items,
  isDisabled,
  onUndo,
}: {
  items: readonly AutoAppliedTagItem[];
  isDisabled: boolean;
  onUndo: (item: AutoAppliedTagItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Tags added automatically" className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.changeId} className="flex flex-wrap items-center gap-x-2">
          <span className="typescale-label-md text-ink-muted">
            Added automatically: <span className="text-ink">{item.name}</span>
            {item.reason ? <span className="text-ink-faint">{` · ${item.reason}`}</span> : null}
          </span>
          <AriaButton
            aria-label={`Undo tag ${item.name}`}
            isDisabled={isDisabled}
            onPress={() => onUndo(item)}
            className="state-layer flex min-h-11 items-center gap-1 rounded-sm px-2 typescale-label-md text-ink data-disabled:opacity-40 medium:min-h-8"
          >
            <Undo2 className="size-3.5 shrink-0" />
            Undo
          </AriaButton>
        </li>
      ))}
    </ul>
  );
}
