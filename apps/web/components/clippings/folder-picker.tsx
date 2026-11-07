"use client";

import { FolderInput, FolderPlus } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { Button as AriaButton, Link } from "react-aria-components";

import { moveToFolderAction } from "@/app/(app)/c/[id]/actions.ts";
import { useOnline } from "@/components/online-status.tsx";
import { hrefWithFolder } from "@/lib/clippings/browse-params.ts";
import { MAX_FOLDER_NAME_LENGTH, type Folder } from "@clippings/shared";
import {
  Button,
  Dialog,
  Heading,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  TagDot,
  TextField,
  toasts,
} from "@clippings/ui";

function NewFolderForm({
  onCreate,
}: {
  /** Files the clipping in a new folder; the reason it can't be, or null when it was. */
  onCreate: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  // Submitted by hand, not as a form action: an action resets the form, and the field would put
  // the empty name back under the error.
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const refused = await onCreate(name);
      if (refused) setError(refused);
    });
  }

  return (
    <form onSubmit={create} className="flex flex-col gap-4">
      <TextField
        label="Folder name"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog was opened to fill this field
        autoFocus
        isRequired
        maxLength={MAX_FOLDER_NAME_LENGTH}
        value={name}
        onChange={(value) => {
          setName(value);
          setError(undefined);
        }}
        autoComplete="off"
        errorMessage={error}
      />
      <div className="flex justify-end gap-2">
        <Button variant="text" slot="close">
          Cancel
        </Button>
        <Button type="submit" isPending={isPending}>
          Create and move
        </Button>
      </div>
    </form>
  );
}

/**
 * The folder a clipping or note sits in, and a menu to move it to another or to a new one. Each
 * move is the user's own logged change, so the review screen can undo it.
 */
export function FolderPicker({
  clippingId,
  folder: initialFolder,
  folders,
}: {
  clippingId: string;
  folder: Folder | null;
  /** The user's folders. */
  folders: readonly Folder[];
}) {
  const online = useOnline();
  const [folder, setFolder] = useState(initialFolder);
  // Folders made here, offered before the server's list arrives.
  const [made, setMade] = useState<readonly Folder[]>([]);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const choices = [...folders, ...made.filter((one) => !folders.some(({ id }) => id === one.id))];

  /** Files the clipping; the reason it couldn't be, or null when it was. */
  async function move(target: Parameters<typeof moveToFolderAction>[1]) {
    const outcome = await moveToFolderAction(clippingId, target).catch(() => null);
    if (outcome?.status === "moved") {
      setFolder(outcome.folder);
      setMade((current) => [...current, outcome.folder]);
      return null;
    }
    return outcome?.message ?? "Couldn't move it. Try again.";
  }

  async function moveTo(chosen: Folder) {
    if (chosen.id === folder?.id) return;
    const refused = await move({ folderId: chosen.id });
    if (refused) toasts.show({ message: refused });
  }

  async function moveToNew(name: string) {
    const refused = await move({ newFolder: name });
    if (!refused) setIsNewOpen(false);
    return refused;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 print:hidden">
      <span className="typescale-label-md text-ink-faint">Folder</span>
      {folder ? (
        <Link
          href={hrefWithFolder(folder.id)}
          className="state-layer inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-sm border border-line-strong px-2 typescale-label-md text-ink"
        >
          <TagDot color={folder.color} showNone />
          <span className="truncate">{folder.name}</span>
        </Link>
      ) : (
        <span className="typescale-label-md text-ink-muted">Not filed yet</span>
      )}
      <MenuTrigger>
        <AriaButton
          aria-label={folder ? "Move to another folder" : "Move to a folder"}
          isDisabled={!online}
          className="state-layer flex min-h-11 cursor-default items-center gap-1.5 rounded-md px-2.5 typescale-label-lg text-ink-muted data-disabled:opacity-40 medium:min-h-8"
        >
          <FolderInput className="size-4.5" />
          Move
        </AriaButton>
        <Menu
          aria-label="Folders"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={folder ? [folder.id] : []}
          items={choices}
          renderEmptyState={() => (
            <p className="px-2.5 py-2 typescale-body-md text-ink-muted">No folders yet</p>
          )}
          onAction={(key) => {
            const chosen = choices.find((one) => one.id === key);
            if (chosen) void moveTo(chosen);
          }}
        >
          {(one) => (
            <MenuItem id={one.id} leading={<TagDot color={one.color} showNone />}>
              {one.name}
            </MenuItem>
          )}
        </Menu>
      </MenuTrigger>
      <Button variant="text" isDisabled={!online} onPress={() => setIsNewOpen(true)}>
        <FolderPlus className="size-4.5" />
        New folder
      </Button>
      <Modal isDismissable isOpen={isNewOpen} onOpenChange={setIsNewOpen}>
        <Dialog>
          <Heading>New folder</Heading>
          <NewFolderForm onCreate={moveToNew} />
        </Dialog>
      </Modal>
    </div>
  );
}
