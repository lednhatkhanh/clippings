"use client";

import { Link as LinkIcon, Puzzle } from "lucide-react";
import { useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { useFormStatus } from "react-dom";

import { revokeConnectionAction } from "@/app/(app)/settings/actions.ts";
import { Button, Dialog, Heading, Modal, toasts } from "@clippings/ui";

import { SettingsCard, SettingsRow } from "./settings-section.tsx";

/** A connected client as the Connections tab shows it. */
export interface ConnectionRow {
  clientId: string;
  name: string;
  /** "Last used 3 hours ago", or "Not used yet". */
  lastUsed: string;
}

function RevokeButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" isPending={pending}>
      Revoke
    </Button>
  );
}

function ConnectionItem({ connection }: { connection: ConnectionRow }) {
  const [isOpen, setIsOpen] = useState(false);

  async function revoke() {
    // A thrown action (a lost session, an unreachable database) gets the same toast as a refusal.
    if (await revokeConnectionAction(connection.clientId).catch(() => false)) setIsOpen(false);
    else toasts.show({ message: `Couldn't revoke ${connection.name}. Try again.` });
  }

  const Glyph = /extension/i.test(connection.name) ? Puzzle : LinkIcon;

  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-on-accent-soft"
          >
            <Glyph className="size-4.5" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate typescale-title-sm text-ink">{connection.name}</span>
            <span className="typescale-body-sm font-normal text-ink-faint">
              {connection.lastUsed}
            </span>
          </span>
        </span>
      }
    >
      <AriaButton
        onPress={() => setIsOpen(true)}
        className="state-layer flex h-11 cursor-default items-center rounded-md px-4 typescale-label-lg text-danger medium:h-10"
      >
        Revoke
      </AriaButton>
      <Modal isDismissable isOpen={isOpen} onOpenChange={setIsOpen}>
        <Dialog role="alertdialog">
          <Heading>{`Revoke ${connection.name}?`}</Heading>
          <form action={revoke} className="flex flex-col gap-4">
            <p className="typescale-body-md text-ink-muted">
              It loses access to your clippings right away. To use it again, connect it again.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="text" slot="close">
                Cancel
              </Button>
              <RevokeButton />
            </div>
          </form>
        </Dialog>
      </Modal>
    </SettingsRow>
  );
}

/** The apps connected to the account through OAuth (Claude, the extension), each revocable. */
export function ConnectionsSettings({ connections }: { connections: readonly ConnectionRow[] }) {
  return (
    <SettingsCard title="Connected apps">
      {connections.length === 0 ? (
        <p className="py-4.5 typescale-body-md text-ink-muted">
          No apps are connected. Connect Claude or the Clippings extension, and it shows up here.
        </p>
      ) : (
        connections.map((connection) => (
          <ConnectionItem key={connection.clientId} connection={connection} />
        ))
      )}
    </SettingsCard>
  );
}
