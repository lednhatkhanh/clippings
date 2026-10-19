"use client";

import { createContext, use, useState, type ReactNode } from "react";

import { deleteClippingAction, restoreClippingAction } from "@/app/(app)/actions.ts";
import { toasts } from "@clippings/ui";

/**
 * Where a deleted clipping's row is in its motion: "leaving" while it fades and collapses, "gone"
 * once it has, and "returning" while an undone one expands and fades back in.
 */
export type RowPresence = "leaving" | "gone" | "returning";

interface DeletedClippings {
  /** Clippings deleted in this tab, hidden before the server has confirmed, and those coming back. */
  presence: ReadonlyMap<string, RowPresence>;
  hide: (clippingId: string) => void;
  show: (clippingId: string) => void;
  /** A row finished leaving or returning. */
  settle: (clippingId: string) => void;
}

const DeletedClippingsContext = createContext<DeletedClippings | null>(null);

function useDeletedClippings(): DeletedClippings {
  const context = use(DeletedClippingsContext);
  if (!context) throw new Error("DeletedClippingsProvider is missing");
  return context;
}

function withPresence(
  current: ReadonlyMap<string, RowPresence>,
  clippingId: string,
  presence: RowPresence | null,
): ReadonlyMap<string, RowPresence> {
  const next = new Map(current);
  if (presence) next.set(clippingId, presence);
  else next.delete(clippingId);
  return next;
}

/** Holds the clippings deleted in this tab, so every view drops them at once. */
export function DeletedClippingsProvider({ children }: { children: ReactNode }) {
  const [presence, setPresence] = useState<ReadonlyMap<string, RowPresence>>(new Map());

  const hide = (clippingId: string) =>
    setPresence((current) => withPresence(current, clippingId, "leaving"));
  // The row expands back in, whether it is still collapsing, has gone, or is only now coming back
  // from the server (after a delete there, a list loaded fresh no longer had it).
  const show = (clippingId: string) =>
    setPresence((current) =>
      withPresence(current, clippingId, current.has(clippingId) ? "returning" : null),
    );
  const settle = (clippingId: string) =>
    setPresence((current) => {
      const state = current.get(clippingId);
      if (state === "leaving") return withPresence(current, clippingId, "gone");
      if (state === "returning") return withPresence(current, clippingId, null);
      return current;
    });

  return (
    <DeletedClippingsContext value={{ presence, hide, show, settle }}>
      {children}
    </DeletedClippingsContext>
  );
}

/**
 * Where each deleted clipping's row is in its motion, for lists to animate it out and back, and
 * `settle` for a row to call when its animation ends.
 */
export function useRowPresence(): Pick<DeletedClippings, "presence" | "settle"> {
  const { presence, settle } = useDeletedClippings();
  return { presence, settle };
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
