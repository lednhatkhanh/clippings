"use client";

import { X } from "lucide-react";
import { Fragment } from "react";

import { Button, Dialog, Heading, Modal } from "@clippings/ui";

import { SHORTCUT_GROUPS, type ShortcutRow } from "./shortcut-groups.ts";

function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-b-2 border-line-strong bg-paper px-1.5 font-mono text-xs font-medium text-ink">
      {children}
    </kbd>
  );
}

function Row({ label, keys, between }: ShortcutRow) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 border-t border-line first:border-t-0">
      <dt className="typescale-body-md">{label}</dt>
      <dd className="flex items-center gap-1 typescale-body-sm text-ink-faint">
        {keys.map((key, index) => (
          <Fragment key={key}>
            {index > 0 && between ? <span>{between}</span> : null}
            <KeyCap>{key}</KeyCap>
          </Fragment>
        ))}
      </dd>
    </div>
  );
}

/** The "?" sheet: every keyboard shortcut the app has, grouped by where it works. */
export function ShortcutsSheet({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  return (
    <Modal isDismissable isOpen={isOpen} onOpenChange={onOpenChange}>
      <Dialog>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Heading>Keyboard shortcuts</Heading>
            <p className="typescale-body-md text-ink-faint">
              Shortcuts are off while you type in a field. Turn single-key shortcuts off in
              Settings.
            </p>
          </div>
          <Button variant="text" slot="close" aria-label="Close" aria-keyshortcuts="Escape">
            <X className="size-5" />
          </Button>
        </div>
        <div className="grid gap-x-8 gap-y-5 medium:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="flex flex-col gap-1.5">
              <h3 className="typescale-label-md text-ink-faint uppercase">{group.title}</h3>
              <dl>
                {group.rows.map((row) => (
                  <Row key={row.label} {...row} />
                ))}
              </dl>
            </section>
          ))}
        </div>
      </Dialog>
    </Modal>
  );
}
