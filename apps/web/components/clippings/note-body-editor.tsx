"use client";

import { Eye, Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";

import { previewMarkdownAction, updateNoteBodyAction } from "@/app/(app)/actions.ts";
import { useOnline } from "@/components/online-status.tsx";
import { MAX_NOTE_BODY_LENGTH } from "@clippings/shared";
import { Button, Segment, SegmentedButtons, TextField } from "@clippings/ui";

import { SaveStatus, type SaveState } from "./save-status.tsx";

type Mode = "preview" | "edit";

const STATUS_TEXT: Record<SaveState, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  failed: "Couldn't save your note. Try again.",
};

/**
 * A note's text with an Edit/Preview toggle. Preview shows the Markdown formatted: the saved text
 * is rendered on the server and passed in, so reading adds no Markdown code to the page, and text
 * not saved yet is rendered by the server on demand. Edit is a plain multiline field (the source
 * is Markdown, kept exactly as typed). Saving is explicit, because every save embeds the text again.
 */
export function NoteBodyEditor({
  clippingId,
  body,
  rendered,
}: {
  clippingId: string;
  /** The saved text. */
  body: string;
  /** The saved text as formatted Markdown, rendered on the server. */
  rendered: ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("preview");
  const [draft, setDraft] = useState(body);
  const [saved, setSaved] = useState({ body, rendered });
  const [draftPreview, setDraftPreview] = useState<{ source: string; node: ReactNode } | null>(
    null,
  );
  const [state, setState] = useState<SaveState>("idle");
  const [invalid, setInvalid] = useState<string | null>(null);
  const online = useOnline();

  const dirty = draft !== saved.body;

  async function changeMode(next: Mode) {
    setMode(next);
    if (next !== "preview" || !dirty || draftPreview?.source === draft) return;
    const source = draft;
    try {
      setDraftPreview({ source, node: await previewMarkdownAction(source) });
    } catch {
      setDraftPreview({
        source,
        node: <p className="text-danger">Couldn&apos;t show the preview.</p>,
      });
    }
  }

  async function save() {
    setState("saving");
    setInvalid(null);
    const text = draft;
    const outcome = await updateNoteBodyAction(clippingId, text).catch(() => null);
    if (outcome?.status === "saved") {
      setSaved({ body: text, rendered: outcome.rendered });
      setState("saved");
    } else if (outcome?.status === "invalid") {
      setInvalid(outcome.message);
      setState("idle");
    } else {
      setState("failed");
    }
  }

  function discard() {
    setDraft(saved.body);
    setInvalid(null);
    setState("idle");
  }

  function edit(text: string) {
    setDraft(text);
    setInvalid(null);
    if (state !== "idle") setState("idle");
  }

  return (
    <section aria-label="Note text" className="flex flex-col gap-3">
      <SegmentedButtons
        aria-label="Note view"
        selectedKey={mode}
        onSelectionChange={(key) => void changeMode(key === "edit" ? "edit" : "preview")}
        className="medium:w-60"
      >
        <Segment id="preview" icon={Eye}>
          Preview
        </Segment>
        <Segment id="edit" icon={Pencil}>
          Edit
        </Segment>
      </SegmentedButtons>

      {mode === "edit" ? (
        <div className="flex flex-col gap-2">
          <TextField
            label="Text (Markdown)"
            multiline
            rows={12}
            maxLength={MAX_NOTE_BODY_LENGTH}
            value={draft}
            isDisabled={!online}
            onChange={edit}
            errorMessage={invalid ?? undefined}
          />
          <div className="flex items-center justify-between gap-3">
            <SaveStatus state={state} text={STATUS_TEXT[state]} />
            <div className="flex gap-2">
              <Button variant="text" isDisabled={!dirty} onPress={discard}>
                Discard changes
              </Button>
              <Button
                variant="filled"
                isPending={state === "saving"}
                isDisabled={!dirty || !online}
                onPress={() => void save()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-reading">
          {!dirty ? (
            saved.rendered
          ) : draftPreview?.source === draft ? (
            <>
              {draftPreview.node}
              <p className="pt-3 typescale-label-sm text-ink-faint">
                Not saved yet. Switch to Edit to save it.
              </p>
            </>
          ) : (
            <p className="typescale-body-md text-ink-faint">Loading the preview…</p>
          )}
        </div>
      )}
    </section>
  );
}
