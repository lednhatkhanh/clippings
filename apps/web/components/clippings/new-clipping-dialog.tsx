"use client";

import { Plus } from "lucide-react";
import { createContext, use, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { saveClippingAction, updateClippingAction, type SaveOutcome } from "@/app/(app)/actions.ts";
import { useOnline } from "@/components/online-status.tsx";
import { useLaunchParam } from "@/components/use-launch-param.ts";
import { hrefWithTag, loadBrowseParams } from "@/lib/clippings/browse-params.ts";
import { MAX_NOTE_LENGTH, MAX_TAG_LENGTH } from "@clippings/shared";
import {
  Button,
  Dialog,
  Heading,
  LinkButton,
  Modal,
  TagChips,
  TagPicker,
  TextField,
} from "@clippings/ui";

import { useShowClipping } from "./deleted-clippings.tsx";
import { useTags } from "./use-tags.ts";

function SubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  const online = useOnline();
  return (
    <Button type="submit" isPending={pending} isDisabled={!online}>
      {children}
    </Button>
  );
}

type Existing = Extract<SaveOutcome, { status: "existing" }>;

/**
 * The URL was already saved: say when, show its note and tags as they stand (the save changed
 * neither), and offer to open it, where its tags are edited, or to change its note.
 */
function AlreadySaved({ existing, onDone }: { existing: Existing; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);

  async function updateNote(formData: FormData) {
    const note = formData.get("note");
    if (await updateClippingAction(existing.clippingId, typeof note === "string" ? note : "")) {
      onDone();
    } else {
      setFailed(true);
    }
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
      {existing.note ? <p className="typescale-body-md text-ink-muted">{existing.note}</p> : null}
      <TagChips
        aria-label="Its tags"
        tags={existing.tags}
        href={(tag) => hrefWithTag(loadBrowseParams(""), tag)}
      />
      <div className="flex justify-end gap-2">
        <LinkButton variant="filled" href={`/c/${existing.clippingId}`}>
          Open
        </LinkButton>
        <Button variant="paper" onPress={() => setEditing(true)}>
          Update note
        </Button>
      </div>
    </output>
  );
}

function SaveForm({ initial, onSaved }: { initial: Prefill; onSaved: () => void }) {
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [tagNames, setTagNames] = useState<string[]>([]);
  const { tags, refresh } = useTags();
  const showClipping = useShowClipping();

  async function save(formData: FormData) {
    const result = await saveClippingAction(formData);
    if (result.status === "created") {
      // Saving a page deleted in this tab brings back the same clipping, so unhide it.
      showClipping(result.clippingId);
      // The save may have created tags.
      if (tagNames.length > 0) refresh();
      onSaved();
    } else {
      setOutcome(result);
    }
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
        defaultValue={initial.url}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- ready to paste, or to check a dropped link
        autoFocus
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
        defaultValue={initial.note}
        errorMessage={invalid?.field === "note" ? invalid.message : undefined}
      />
      <TagPicker
        label="Tags (optional)"
        name="tags"
        tags={tags}
        value={tagNames}
        onChange={setTagNames}
        maxLength={MAX_TAG_LENGTH}
        errorMessage={invalid?.field === "tags" ? invalid.message : undefined}
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

/** What "New clipping" opens with: a dropped link's address, or a share's address and quote. */
interface Prefill {
  url?: string;
  note?: string;
}

/** Opens "New clipping", filled in with what there is. */
type OpenNewClipping = (prefill?: Prefill) => void;

const NewClippingContext = createContext<OpenNewClipping | null>(null);

export function useOpenNewClipping(): OpenNewClipping {
  const open = use(NewClippingContext);
  if (!open) throw new Error("NewClippingProvider is missing");
  return open;
}

/**
 * The "New clipping" dialog, one for the whole app, so the button, the command palette, a
 * dropped link and a share all open the same one. `/?new` (an app shortcut) opens it too.
 */
export function NewClippingProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initial, setInitial] = useState<Prefill>({});

  const open: OpenNewClipping = (prefill = {}) => {
    // Already open: keep what has been typed rather than start over.
    if (isOpen) return;
    setInitial(prefill);
    setIsOpen(true);
  };
  // `/?new`, the New clipping app shortcut.
  useLaunchParam("new", () => open());

  return (
    <NewClippingContext value={open}>
      {children}
      <Modal isDismissable isOpen={isOpen} onOpenChange={setIsOpen}>
        <Dialog>
          <Heading>New clipping</Heading>
          {/* The modal unmounts its children once it has closed, so every open starts a fresh form. */}
          <SaveForm initial={initial} onSaved={() => setIsOpen(false)} />
        </Dialog>
      </Modal>
    </NewClippingContext>
  );
}

/** The "New clipping" button. */
export function NewClippingDialog() {
  const open = useOpenNewClipping();
  const online = useOnline();

  return (
    <Button variant="filled" isDisabled={!online} onPress={() => open()}>
      <Plus className="size-4.5" />
      New clipping
    </Button>
  );
}
