"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button as AriaButton, Link } from "react-aria-components";
import { useFormStatus } from "react-dom";

import {
  deleteTagAction,
  mergeTagAction,
  renameTagAction,
  setTagColorAction,
} from "@/app/(app)/tags/actions.ts";
import { hrefWithTag, loadBrowseParams } from "@/lib/clippings/browse-params.ts";
import { MAX_TAG_LENGTH, TAG_COLORS, type TagColor, type TagSummary } from "@clippings/shared";
import {
  Button,
  Dialog,
  Heading,
  Icon,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  SubmenuTrigger,
  TAG_COLOR_LABELS,
  TagDot,
  TextField,
  toasts,
} from "@clippings/ui";

const countLabel = (count: number) => (count === 1 ? "clipping" : "clippings");

/** What the open dialog asks about; it stays set while the dialog animates out. */
type Pending = { kind: "rename" } | { kind: "merge"; target: TagSummary } | { kind: "delete" };

function SubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" isPending={pending}>
      {children}
    </Button>
  );
}

function RenameForm({ tag, onDone }: { tag: TagSummary; onDone: () => void }) {
  const [name, setName] = useState(tag.name);
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  // Submitted by hand, not as a form action: an action resets the form afterwards, and the field
  // would put the old name back under the error.
  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const outcome = await renameTagAction(tag.id, name);
      if (outcome?.status === "invalid") setError(outcome.message);
      else if (outcome) onDone();
      else setError("Couldn't rename the tag. Try again.");
    });
  }

  return (
    <form onSubmit={rename} className="flex flex-col gap-4">
      <TextField
        label="Name"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog was opened to edit this field
        autoFocus
        isRequired
        maxLength={MAX_TAG_LENGTH}
        value={name}
        onChange={(value) => {
          setName(value);
          // The error marks the field invalid, which would block the next submit.
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
          Rename
        </Button>
      </div>
    </form>
  );
}

/** Asks before a change that can't be undone, then makes it. */
function ConfirmForm({
  children,
  action,
  confirmLabel,
  failure,
  onDone,
}: {
  children: string;
  action: () => Promise<boolean>;
  confirmLabel: string;
  failure: string;
  onDone: () => void;
}) {
  async function confirm() {
    // A thrown action (a lost session, an unreachable database) gets the same toast as a refusal.
    if (await action().catch(() => false)) onDone();
    else toasts.show({ message: failure });
  }

  return (
    <form action={confirm} className="flex flex-col gap-4">
      <p className="typescale-body-md text-on-surface-variant">{children}</p>
      <div className="flex justify-end gap-2">
        <Button variant="text" slot="close">
          Cancel
        </Button>
        <SubmitButton>{confirmLabel}</SubmitButton>
      </div>
    </form>
  );
}

function TagDialog({
  tag,
  pending,
  onDone,
}: {
  tag: TagSummary;
  pending: Pending;
  onDone: () => void;
}) {
  const clippings = `${tag.clippingCount} ${countLabel(tag.clippingCount)}`;
  switch (pending.kind) {
    case "rename":
      return (
        <Dialog>
          <Heading>Rename tag</Heading>
          <RenameForm tag={tag} onDone={onDone} />
        </Dialog>
      );
    case "merge":
      return (
        <Dialog role="alertdialog">
          <Heading>{`Merge into “${pending.target.name}”?`}</Heading>
          <ConfirmForm
            action={() => mergeTagAction(tag.id, pending.target.id)}
            confirmLabel="Merge"
            failure="Couldn't merge the tags. Try again."
            onDone={onDone}
          >
            {tag.clippingCount === 0
              ? `“${tag.name}” will be removed. No clippings carry it.`
              : `Its ${clippings} will be tagged “${pending.target.name}” instead, and “${tag.name}” will be removed.`}
          </ConfirmForm>
        </Dialog>
      );
    case "delete":
      return (
        <Dialog role="alertdialog">
          <Heading>{`Delete “${tag.name}”?`}</Heading>
          <ConfirmForm
            action={() => deleteTagAction(tag.id)}
            confirmLabel="Delete"
            failure="Couldn't delete the tag. Try again."
            onDone={onDone}
          >
            {tag.clippingCount === 0
              ? "No clippings carry it."
              : `It comes off its ${clippings}. The clippings themselves stay.`}
          </ConfirmForm>
        </Dialog>
      );
  }
}

function TagRow({ tag, others }: { tag: TagSummary; others: readonly TagSummary[] }) {
  const [pending, setPending] = useState<Pending>({ kind: "rename" });
  const [isOpen, setIsOpen] = useState(false);

  function open(next: Pending) {
    setPending(next);
    setIsOpen(true);
  }

  async function setColor(color: TagColor) {
    if (color === tag.color) return;
    if (!(await setTagColorAction(tag.id, color).catch(() => false))) {
      toasts.show({ message: "Couldn't change the tag's color. Try again." });
    }
  }

  return (
    <li className="flex items-center gap-3 py-1 ps-4 pe-1">
      <Link
        href={hrefWithTag(loadBrowseParams(""), tag.name)}
        className="state-layer -my-1 -ms-4 flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-sm ps-4 outline-secondary"
      >
        <TagDot color={tag.color} showNone />
        <span className="min-w-0 flex-1 truncate typescale-body-lg text-on-surface">
          {tag.name}
        </span>
        <span className="typescale-body-md text-on-surface-variant tabular-nums">
          {tag.clippingCount}
          <span className="sr-only"> {countLabel(tag.clippingCount)}</span>
        </span>
      </Link>
      <MenuTrigger>
        <AriaButton
          aria-label={`Actions for ${tag.name}`}
          className="state-layer flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant outline-secondary"
        >
          <Icon name="more_vert" />
        </AriaButton>
        <Menu aria-label={`Actions for ${tag.name}`}>
          <MenuItem icon="edit" onAction={() => open({ kind: "rename" })}>
            Rename…
          </MenuItem>
          <SubmenuTrigger>
            <MenuItem icon="palette">Color</MenuItem>
            <Menu
              aria-label="Color"
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[tag.color]}
              onAction={(key) => void setColor(key as TagColor)}
            >
              {TAG_COLORS.map((color) => (
                <MenuItem key={color} id={color} leading={<TagDot color={color} showNone />}>
                  {TAG_COLOR_LABELS[color]}
                </MenuItem>
              ))}
            </Menu>
          </SubmenuTrigger>
          <SubmenuTrigger>
            <MenuItem icon="merge" isDisabled={others.length === 0}>
              Merge into
            </MenuItem>
            <Menu aria-label="Merge into" items={others}>
              {(other) => (
                <MenuItem
                  id={other.id}
                  leading={<TagDot color={other.color} showNone />}
                  onAction={() => open({ kind: "merge", target: other })}
                >
                  {other.name}
                </MenuItem>
              )}
            </Menu>
          </SubmenuTrigger>
          <MenuSeparator />
          <MenuItem icon="delete" onAction={() => open({ kind: "delete" })}>
            Delete…
          </MenuItem>
        </Menu>
      </MenuTrigger>
      <Modal isDismissable isOpen={isOpen} onOpenChange={setIsOpen}>
        <TagDialog tag={tag} pending={pending} onDone={() => setIsOpen(false)} />
      </Modal>
    </li>
  );
}

/** The user's tags, each with its color, count and a menu to rename, recolor, merge or delete. */
export function TagList({ tags }: { tags: readonly TagSummary[] }) {
  return (
    <ul aria-label="Your tags" className="flex flex-col">
      {tags.map((tag) => (
        <TagRow key={tag.id} tag={tag} others={tags.filter((other) => other.id !== tag.id)} />
      ))}
    </ul>
  );
}
