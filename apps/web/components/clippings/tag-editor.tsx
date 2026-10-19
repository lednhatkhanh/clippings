"use client";

import { useRef, useState } from "react";

import { updateClippingTagsAction } from "@/app/(app)/actions.ts";
import { useOnline } from "@/components/online-status.tsx";
import { hrefWithTag, loadBrowseParams } from "@/lib/clippings/browse-params.ts";
import { MAX_TAG_LENGTH, type Tag } from "@clippings/shared";
import { TagPicker } from "@clippings/ui";

import { useTags } from "./use-tags.ts";

type SaveState = "idle" | "saving" | "saved" | "failed";

const STATUS_TEXT: Record<SaveState, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  failed: "Couldn't save your tags. Change them to try again.",
};

/** Each chip leads to the whole list, filtered by its tag. */
const tagListHref = (tag: string) => hrefWithTag(loadBrowseParams(""), tag);

/**
 * The clipping's tags, edited in place: each change saves at once, one save at a time, and the
 * status is a polite live region, like the note's.
 */
export function TagEditor({ clippingId, tags: initialTags }: { clippingId: string; tags: Tag[] }) {
  const [value, setValue] = useState(() => initialTags.map((tag) => tag.name));
  const [state, setState] = useState<SaveState>("idle");
  const { tags, refresh } = useTags();
  const online = useOnline();
  // The clipping's own tags come with the page, so their colors show before the rest load.
  const offered = [...tags, ...initialTags.filter((tag) => !tags.some(({ id }) => id === tag.id))];
  // Saves go out one at a time, so an older one never lands after a newer one.
  const queue = useRef<Promise<void>>(Promise.resolve());
  // The names last chosen: only the save of those may set the status.
  const latest = useRef(value);

  function change(names: string[]) {
    setValue(names);
    latest.current = names;
    setState("saving");
    queue.current = queue.current.then(async () => {
      const saved = await updateClippingTagsAction(clippingId, names).catch(() => null);
      if (saved) refresh();
      if (latest.current === names) setState(saved ? "saved" : "failed");
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <TagPicker
        label="Tags"
        tags={offered}
        value={value}
        onChange={change}
        tagHref={tagListHref}
        maxLength={MAX_TAG_LENGTH}
        isDisabled={!online}
      />
      {/* An <output> is a polite live region, so the status is announced without moving focus. */}
      <output aria-live="polite" className="min-h-4 typescale-label-sm text-on-surface-variant">
        {STATUS_TEXT[state]}
      </output>
    </div>
  );
}
