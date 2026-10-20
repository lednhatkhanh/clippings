"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { revokeConnectionAction } from "@/app/(app)/settings/actions.ts";
import { Button, Dialog, Heading, Modal, toasts } from "@clippings/ui";

import { SettingsSection } from "./settings-section.tsx";

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
    <Button type="submit" isPending={pending}>
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

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate typescale-body-lg text-on-surface">{connection.name}</span>
        <span className="typescale-body-md text-on-surface-variant">{connection.lastUsed}</span>
      </div>
      <Button variant="outlined" onPress={() => setIsOpen(true)}>
        Revoke
      </Button>
      <Modal isDismissable isOpen={isOpen} onOpenChange={setIsOpen}>
        <Dialog role="alertdialog">
          <Heading>{`Revoke ${connection.name}?`}</Heading>
          <form action={revoke} className="flex flex-col gap-4">
            <p className="typescale-body-md text-on-surface-variant">
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
    </li>
  );
}

/** The apps connected to the account through OAuth (Claude, the extension), each revocable. */
export function ConnectionsSettings({ connections }: { connections: readonly ConnectionRow[] }) {
  return (
    <SettingsSection
      title="Connected apps"
      description="Apps that can read and save your clippings. Revoking one signs it out at once."
    >
      {connections.length === 0 ? (
        <p className="typescale-body-md text-on-surface-variant">
          No apps are connected. Connect Claude or the Clippings extension, and it shows up here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-outline-variant">
          {connections.map((connection) => (
            <ConnectionItem key={connection.clientId} connection={connection} />
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
