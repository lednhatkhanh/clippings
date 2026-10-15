"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Icon,
  LinkButton,
  Modal,
  TextField,
} from "@clippings/ui";

import { saveClippingAction, updateNoteAction, type SaveOutcome } from "../../app/(app)/actions";
import { MAX_NOTE_LENGTH } from "../../lib/clippings/note";

function SubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" isPending={pending}>
      {children}
    </Button>
  );
}

type Existing = Extract<SaveOutcome, { status: "existing" }>;

/** The URL was already saved: say when, and offer to open it or change its note. */
function AlreadySaved({ existing, onDone }: { existing: Existing; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);

  async function updateNote(formData: FormData) {
    if (await updateNoteAction(existing.clippingId, formData)) onDone();
    else setFailed(true);
  }

  if (editing) {
    return (
      <form action={updateNote} className="flex flex-col gap-4">
        <TextField
          name="note"
          label="Note"
          multiline
          rows={4}
          maxLength={MAX_NOTE_LENGTH}
          defaultValue={existing.note}
          errorMessage={failed ? "Couldn't update the note. Try again." : undefined}
        />
        <div className="flex justify-end gap-2">
          <Button variant="text" onPress={onDone}>
            Cancel
          </Button>
          <SubmitButton>Update note</SubmitButton>
        </div>
      </form>
    );
  }

  return (
    <output className="flex flex-col gap-3">
      <p className="typescale-body-lg">Already saved on {existing.savedOn}.</p>
      {existing.note ? (
        <p className="typescale-body-md text-on-surface-variant">{existing.note}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <LinkButton href={existing.url} target="_blank" rel="noopener noreferrer">
          Open
        </LinkButton>
        <Button variant="tonal" onPress={() => setEditing(true)}>
          Update note
        </Button>
      </div>
    </output>
  );
}

function SaveForm({ onSaved }: { onSaved: () => void }) {
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);

  async function save(formData: FormData) {
    const result = await saveClippingAction(formData);
    if (result.status === "created") onSaved();
    else setOutcome(result);
  }

  if (outcome?.status === "existing") {
    return <AlreadySaved existing={outcome} onDone={onSaved} />;
  }

  const invalid = outcome?.status === "invalid" ? outcome : null;
  return (
    <form action={save} className="flex flex-col gap-4">
      <TextField
        name="url"
        label="Address"
        placeholder="https://"
        inputMode="url"
        autoComplete="off"
        isRequired
        errorMessage={invalid?.field === "url" ? invalid.message : undefined}
      />
      <TextField
        name="note"
        label="Note (optional)"
        multiline
        rows={3}
        maxLength={MAX_NOTE_LENGTH}
        errorMessage={invalid?.field === "note" ? invalid.message : undefined}
      />
      <div className="flex justify-end gap-2">
        <Button variant="text" slot="close">
          Cancel
        </Button>
        <SubmitButton>Save</SubmitButton>
      </div>
    </form>
  );
}

/** The "New clipping" button and the dialog it opens. */
export function NewClippingDialog() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button variant="filled">
        <Icon name="add" />
        New clipping
      </Button>
      <Modal isDismissable>
        <Dialog>
          <Heading>New clipping</Heading>
          {/* Remounts on every open, so a previous result never lingers. */}
          {isOpen ? <SaveForm onSaved={() => setIsOpen(false)} /> : null}
        </Dialog>
      </Modal>
    </DialogTrigger>
  );
}
