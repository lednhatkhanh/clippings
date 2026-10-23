"use client";

import { Plus } from "lucide-react";
import { createContext, lazy, Suspense, use, useEffect, useState, type ReactNode } from "react";

import { useOnline } from "@/components/online-status.tsx";
import { useLaunchParam } from "@/components/use-launch-param.ts";
import { whenIdle } from "@/components/when-idle.ts";
import { Button } from "@clippings/ui";

import type { Prefill } from "./new-clipping-modal.tsx";

// The dialog's form (modal, fields, tag picker, save action) is its own chunk: fetched once the
// page is idle, so "New clipping" opens at once without weighing on every page's first load.
const loadNewClippingModal = () => import("./new-clipping-modal.tsx");
const NewClippingModal = lazy(async () => ({
  default: (await loadNewClippingModal()).NewClippingModal,
}));

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
  // Once opened, the dialog stays mounted so closing can animate out.
  const [wasOpened, setWasOpened] = useState(false);
  const [initial, setInitial] = useState<Prefill>({});

  const open: OpenNewClipping = (prefill = {}) => {
    // Already open: keep what has been typed rather than start over.
    if (isOpen) return;
    setInitial(prefill);
    setWasOpened(true);
    setIsOpen(true);
  };
  // `/?new`, the New clipping app shortcut.
  useLaunchParam("new", () => open());
  // Warm the chunk, so the first open doesn't wait for it.
  useEffect(() => whenIdle(() => void loadNewClippingModal()), []);

  return (
    <NewClippingContext value={open}>
      {children}
      {wasOpened ? (
        <Suspense fallback={null}>
          <NewClippingModal isOpen={isOpen} onOpenChange={setIsOpen} initial={initial} />
        </Suspense>
      ) : null}
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
