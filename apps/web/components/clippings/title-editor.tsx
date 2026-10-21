"use client";

import { Pencil, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { renameClippingAction, type RenameOutcome } from "@/app/(app)/actions.ts";
import { useOnline } from "@/components/online-status.tsx";
import { MAX_TITLE_LENGTH } from "@clippings/shared";
import { Button, TextField } from "@clippings/ui";

import { SaveStatus, type SaveState } from "./save-status.tsx";

/** Typing pauses this long before the title is saved; leaving the field saves at once. */
const AUTOSAVE_AFTER_MS = 400;

const TOO_LONG = `Titles can be up to ${MAX_TITLE_LENGTH} characters.`;

const STATUS_TEXT: Record<SaveState, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  failed: "Couldn't save the title. Keep typing to try again.",
};

/**
 * The clipping's heading, renamed in place. "Rename" swaps the heading for a field that saves
 * itself a moment after typing stops and when it loses focus, like the note; Esc puts back the
 * last saved title and Enter finishes. Emptying the field, or typing the page's own title, goes
 * back to the page's title, and "Reset to page title" does the same while the clipping has a
 * title of its own. The status is a polite live region. Offline, renaming is off.
 */
export function TitleEditor({
  clippingId,
  title: initialTitle,
  pageTitle: initialPageTitle,
  titleEdited,
}: {
  clippingId: string;
  /** The title shown: the user's, or the page's. */
  title: string;
  pageTitle: string;
  titleEdited: boolean;
}) {
  // What the server has, as the last save reported it.
  const [saved, setSaved] = useState({
    title: initialTitle,
    pageTitle: initialPageTitle,
    edited: titleEdited,
  });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialTitle);
  const [state, setState] = useState<SaveState>("idle");
  const [resetting, setResetting] = useState(false);
  const online = useOnline();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saves go out one at a time, so an older one never lands after a newer one.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(initialTitle);
  // The text last sent, so the same text is never sent twice.
  const requested = useRef(initialTitle);
  const pageTitle = useRef(initialPageTitle);
  const returnFocus = useRef(false);
  const renameId = `rename-${clippingId}`;

  const tooLong = value.trim().length > MAX_TITLE_LENGTH;

  function cancelPending() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function apply(outcome: RenameOutcome) {
    if (outcome.status !== "saved") return;
    pageTitle.current = outcome.pageTitle;
    setSaved({ title: outcome.title, pageTitle: outcome.pageTitle, edited: outcome.titleEdited });
  }

  function save(text: string) {
    cancelPending();
    const trimmed = text.trim();
    if (trimmed === requested.current.trim() || trimmed.length > MAX_TITLE_LENGTH) return;
    const previous = requested.current;
    requested.current = text;
    setState("saving");
    // The page's own title, or nothing, is the page title again.
    const sent = trimmed === pageTitle.current ? "" : trimmed;
    queue.current = queue.current.then(async () => {
      const outcome = await renameClippingAction(clippingId, sent).catch((): RenameOutcome => ({
        status: "failed",
      }));
      apply(outcome);
      // A failed save leaves the server on the earlier title, so the next edit sends this again.
      if (outcome.status !== "saved" && requested.current === text) requested.current = previous;
      if (latest.current === text) setState(outcome.status === "saved" ? "saved" : "failed");
    });
  }

  function change(text: string) {
    setValue(text);
    latest.current = text;
    if (state === "saved") setState("idle");
    cancelPending();
    timer.current = setTimeout(() => save(text), AUTOSAVE_AFTER_MS);
  }

  function finish({ keepFocus }: { keepFocus: boolean }) {
    // Removing the field can fire a blur after Esc or Enter, which must not undo the return.
    if (keepFocus) returnFocus.current = true;
    save(latest.current);
    setEditing(false);
  }

  function cancel() {
    cancelPending();
    returnFocus.current = true;
    const back = saved.title;
    requested.current = back;
    latest.current = back;
    setValue(back);
    setState("idle");
    setEditing(false);
  }

  function startEditing() {
    latest.current = saved.title;
    requested.current = saved.title;
    setValue(saved.title);
    setState("idle");
    setEditing(true);
  }

  async function reset() {
    setResetting(true);
    try {
      const outcome = await renameClippingAction(clippingId, "").catch((): RenameOutcome => ({
        status: "failed",
      }));
      apply(outcome);
      if (outcome.status === "saved") {
        requested.current = outcome.title;
        latest.current = outcome.title;
        setValue(outcome.title);
        setState("idle");
      } else {
        setState("failed");
      }
    } finally {
      setResetting(false);
    }
  }

  // After Enter or Esc the focus goes back to where the edit began.
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      document.getElementById(renameId)?.focus();
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- renameId follows the page
  }, [editing]);

  // Leaving the page mid-pause still saves the last edit.
  useEffect(
    () => () => {
      if (timer.current) save(latest.current);
    },
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs once, on unmount
    [],
  );

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <TextField
          label="Title"
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- Rename was pressed to type here
          autoFocus
          value={value}
          placeholder={saved.pageTitle}
          errorMessage={tooLong ? TOO_LONG : undefined}
          isDisabled={!online}
          onChange={change}
          // Selected on opening, so typing replaces the title and an arrow key keeps it.
          onFocus={(event) => {
            if (event.target instanceof HTMLInputElement) event.target.select();
          }}
          onBlur={() => finish({ keepFocus: false })}
          onKeyDown={(event) => {
            if (event.key === "Escape") cancel();
            else if (event.key === "Enter") finish({ keepFocus: true });
            else event.continuePropagation();
          }}
        />
        <SaveStatus state={state} text={STATUS_TEXT[state]} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="typescale-headline-sm text-balance wrap-anywhere medium:typescale-headline-md">
        {saved.title}
      </h1>
      <div className="flex flex-wrap items-center gap-x-1 print:hidden">
        <Button id={renameId} variant="text" isDisabled={!online} onPress={startEditing}>
          <Pencil className="size-4.5" />
          Rename
        </Button>
        {saved.edited ? (
          <Button
            variant="text"
            isPending={resetting}
            isDisabled={!online}
            onPress={() => void reset()}
          >
            <RotateCcw className="size-4.5" />
            Reset to page title
          </Button>
        ) : null}
        <SaveStatus state={state} text={state === "failed" ? STATUS_TEXT.failed : ""} />
      </div>
    </div>
  );
}
