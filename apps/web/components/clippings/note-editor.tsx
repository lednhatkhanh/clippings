"use client";

import { useEffect, useRef, useState } from "react";

import { updateClippingAction } from "@/app/(app)/actions.ts";
import { useOnline } from "@/components/online-status.tsx";
import { MAX_NOTE_LENGTH } from "@clippings/shared";
import { TextField } from "@clippings/ui";

/** Typing pauses this long before the note is saved; leaving the field saves at once. */
const AUTOSAVE_AFTER_MS = 400;

type SaveState = "idle" | "saving" | "saved" | "failed";

const STATUS_TEXT: Record<SaveState, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  failed: "Couldn't save your note. Keep typing to try again.",
};

/**
 * The clipping's note, edited in place. It saves itself a moment after typing stops and when
 * the field loses focus; Esc puts back the last saved text. The status is a polite live region.
 * Offline, the field is disabled; an edit whose save failed is sent again once the network is back.
 */
export function NoteEditor({ clippingId, note }: { clippingId: string; note: string }) {
  const [value, setValue] = useState(note);
  const [state, setState] = useState<SaveState>("idle");
  // The text the server has, or will have once the request in flight lands.
  const requested = useRef(note);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saves go out one at a time, so an older one never lands after a newer one.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(note);
  const online = useOnline();

  function cancelPending() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function save(text: string) {
    cancelPending();
    if (text === requested.current) return;
    const previous = requested.current;
    requested.current = text;
    setState("saving");
    queue.current = queue.current.then(async () => {
      const saved = await updateClippingAction(clippingId, text).catch(() => false);
      // A failed save leaves the server on the earlier text, so the next edit sends this again.
      if (!saved && requested.current === text) requested.current = previous;
      if (latest.current === text) setState(saved ? "saved" : "failed");
    });
  }

  function change(text: string) {
    setValue(text);
    latest.current = text;
    // "Saved" would claim the new text is saved; a save in flight or a failure stays shown.
    if (state === "saved") setState("idle");
    cancelPending();
    timer.current = setTimeout(() => save(text), AUTOSAVE_AFTER_MS);
  }

  function revert() {
    cancelPending();
    setValue(requested.current);
    latest.current = requested.current;
    if (state === "failed") setState("idle");
  }

  useEffect(() => {
    const resume = () => save(latest.current);
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- save reads refs; the id stays per page
  }, []);

  // Leaving the page mid-pause still saves the last edit.
  useEffect(
    () => () => {
      if (timer.current) save(latest.current);
    },
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs once, on unmount
    [],
  );

  return (
    <div className="flex flex-col gap-1">
      <TextField
        label="Note"
        placeholder="Why did you keep this?"
        multiline
        rows={4}
        maxLength={MAX_NOTE_LENGTH}
        value={value}
        isDisabled={!online}
        onChange={change}
        onBlur={() => save(latest.current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") revert();
          else event.continuePropagation();
        }}
      />
      {/* An <output> is a polite live region, so the status is announced without moving focus. */}
      <output aria-live="polite" className="min-h-4 typescale-label-sm text-on-surface-variant">
        {STATUS_TEXT[state]}
      </output>
    </div>
  );
}
