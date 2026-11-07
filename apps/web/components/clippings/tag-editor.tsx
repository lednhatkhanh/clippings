"use client";

import { useRef, useState } from "react";

import {
  acceptTagSuggestionAction,
  dismissTagSuggestionsAction,
  undoAutoTagAction,
  updateClippingTagsAction,
} from "@/app/(app)/actions.ts";
import { useOnline } from "@/components/online-status.tsx";
import { hrefWithTag, loadBrowseParams } from "@/lib/clippings/browse-params.ts";
import { MAX_TAG_LENGTH, type Tag } from "@clippings/shared";
import { TagPicker, toasts } from "@clippings/ui";

import { AutoAppliedTags, type AutoAppliedTagItem } from "./auto-applied-tags.tsx";
import { SaveStatus, type SaveState } from "./save-status.tsx";
import { visibleSuggestions } from "./suggestions.ts";
import { TagSuggestions } from "./tag-suggestions.tsx";
import { useTags } from "./use-tags.ts";

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
 * status is a polite live region, like the note's. Under it, a "Suggested" row offers the tags
 * enrichment proposed: a press adds one, and one the clipping already carries is not offered.
 */
export function TagEditor({
  clippingId,
  tags: initialTags,
  suggestedTags = [],
  autoApplied = [],
}: {
  clippingId: string;
  tags: Tag[];
  suggestedTags?: readonly string[];
  /** Tags auto-tagging added, which the user can take back. */
  autoApplied?: readonly AutoAppliedTagItem[];
}) {
  const [value, setValue] = useState(() => initialTags.map((tag) => tag.name));
  // Tags the clipping carried or gained here, for their colors before the rest load.
  const [carried, setCarried] = useState(initialTags);
  // Suggestions accepted or dismissed here, hidden before the server has answered.
  const [gone, setGone] = useState<string[]>([]);
  // Automatic tags taken back here, hidden before the server has answered.
  const [undone, setUndone] = useState<string[]>([]);
  const [state, setState] = useState<SaveState>("idle");
  const { tags, refresh } = useTags();
  const online = useOnline();
  const offered = [...tags, ...carried.filter((tag) => !tags.some(({ id }) => id === tag.id))];
  const suggestions = visibleSuggestions(suggestedTags, value, gone);
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

  function accept(name: string) {
    setGone((current) => [...current, name]);
    const optimistic = [...value, name];
    setValue(optimistic);
    latest.current = optimistic;
    setState("saving");
    queue.current = queue.current.then(async () => {
      const stored = await acceptTagSuggestionAction(clippingId, name).catch(() => null);
      // Only the save of the names last chosen may set the status.
      const isLatest = latest.current === optimistic;
      if (stored) {
        refresh();
        setCarried(stored);
        if (isLatest) {
          // As stored: a suggestion matches an existing tag ignoring case.
          const names = stored.map((tag) => tag.name);
          setValue(names);
          latest.current = names;
        }
      } else {
        setGone((current) => current.filter((hidden) => hidden !== name));
        setValue((current) => current.filter((tag) => tag !== name));
        latest.current = latest.current.filter((tag) => tag !== name);
      }
      if (isLatest) setState(stored ? "saved" : "failed");
    });
  }

  async function dismiss(names?: string[]) {
    const hiding = names ?? suggestions;
    setGone((current) => [...current, ...hiding]);
    const done = await dismissTagSuggestionsAction(clippingId, names).catch(() => false);
    if (done) return;
    setGone((current) => current.filter((name) => !hiding.includes(name)));
    toasts.show({ message: "Couldn't dismiss the suggestions." });
  }

  function undo(item: AutoAppliedTagItem) {
    setUndone((current) => [...current, item.changeId]);
    // Queued behind the tag saves, so a save in flight can't put the tag back.
    queue.current = queue.current.then(async () => {
      const outcome = await undoAutoTagAction(item.changeId).catch(() => null);
      if (outcome?.status === "undone") {
        refresh();
        setCarried((current) => current.filter((tag) => tag.id !== outcome.tagId));
        const gone = (name: string) => name.toLowerCase() !== item.name.toLowerCase();
        setValue((current) => current.filter(gone));
        latest.current = latest.current.filter(gone);
        return;
      }
      setUndone((current) => current.filter((id) => id !== item.changeId));
      toasts.show({ message: outcome?.message ?? "Couldn't undo that tag. Try again." });
    });
  }

  const receipts = autoApplied.filter((item) => !undone.includes(item.changeId));

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
      <TagSuggestions
        names={suggestions}
        isDisabled={!online}
        onAccept={accept}
        onDismiss={(name) => void dismiss([name])}
        onDismissAll={() => void dismiss()}
      />
      <AutoAppliedTags items={receipts} isDisabled={!online} onUndo={undo} />
      <SaveStatus state={state} text={STATUS_TEXT[state]} />
    </div>
  );
}
