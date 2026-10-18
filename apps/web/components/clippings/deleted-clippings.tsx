"use client";

import { createContext, use, useState, type ReactNode } from "react";

import { deleteClippingAction, restoreClippingAction } from "@/app/(app)/actions.ts";
import { toasts } from "@clippings/ui";

interface DeletedClippings {
  /** Clippings deleted in this tab, hidden before the server has confirmed. */
  hidden: ReadonlySet<string>;
  hide: (clippingId: string) => void;
  show: (clippingId: string) => void;
}

const DeletedClippingsContext = createContext<DeletedClippings | null>(null);

function useDeletedClippings(): DeletedClippings {
  const context = use(DeletedClippingsContext);
  if (!context) throw new Error("DeletedClippingsProvider is missing");
  return context;
}

/** Holds the clippings deleted in this tab, so every view drops them at once. */
export function DeletedClippingsProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const hide = (clippingId: string) => setHidden((current) => new Set(current).add(clippingId));
  const show = (clippingId: string) =>
    setHidden((current) => {
      const next = new Set(current);
      next.delete(clippingId);
      return next;
    });

  return (
    <DeletedClippingsContext value={{ hidden, hide, show }}>{children}</DeletedClippingsContext>
  );
}

/** The ids of clippings deleted in this tab, for lists to leave out. */
export function useHiddenClippings(): ReadonlySet<string> {
  return useDeletedClippings().hidden;
}

/** Shows a clipping again in this tab, such as one just saved again after it was deleted. */
export function useShowClipping(): (clippingId: string) => void {
  return useDeletedClippings().show;
}

/**
 * Deletes a clipping optimistically: it disappears at once and a toast offers Undo. If the
 * server refuses, it comes back with an error toast.
 */
export function useDeleteClipping(): (clippingId: string) => void {
  const { hide, show } = useDeletedClippings();

  return (clippingId) => {
    hide(clippingId);
    const deleting = deleteClippingAction(clippingId).catch(() => false);
    let undone = false;

    async function undo() {
      undone = true;
      show(clippingId);
      // Restore only what the server deleted; a delete that failed left nothing to undo.
      if (!(await deleting)) return;
      try {
        // False means it is no longer deleted (saved again meanwhile), which is what Undo wants.
        await restoreClippingAction(clippingId);
      } catch {
        hide(clippingId);
        toasts.show({ message: "Couldn't restore the clipping." });
      }
    }

    const toast = toasts.show({
      message: "Clipping deleted.",
      action: { label: "Undo", onAction: () => void undo() },
    });

    void deleting.then((deleted) => {
      if (deleted || undone) return;
      toasts.close(toast);
      show(clippingId);
      toasts.show({ message: "Couldn't delete the clipping." });
    });
  };
}
