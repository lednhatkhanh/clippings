"use client";

import { Copy, Pin, PinOff, RefreshCw, Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { reEnrichClippingAction, setPinnedAction } from "@/app/(app)/actions.ts";
import { useOnline } from "@/components/online-status.tsx";
import type { ClippingStatus } from "@clippings/shared";
import { Button, toasts } from "@clippings/ui";

import { useRegisterCurrentClipping } from "./current-clipping.ts";
import { copyLinkWithToast, shareLinkWithToast, useCanShare } from "./link-actions.ts";

/**
 * The detail page's quieter actions: Pin, Share (only where the browser has a share sheet), Copy
 * link and, once the page has been read, Read the page again, which keeps the title, note and
 * tags. Pinning answers at once and is undone with an error toast if the server refuses. Offers
 * the clipping to the command palette while mounted.
 */
export function DetailActions({
  clippingId,
  url,
  title,
  pinned: initialPinned,
  status,
}: {
  clippingId: string;
  /** The original page's address. */
  url: string;
  /** The title shown, which Share sends. */
  title: string;
  pinned: boolean;
  status: ClippingStatus;
}) {
  const router = useRouter();
  const online = useOnline();
  const canShare = useCanShare();
  const [pinned, setPinned] = useState(initialPinned);
  const [reading, setReading] = useState(false);

  async function pin(next: boolean) {
    setPinned(next);
    const done = await setPinnedAction(clippingId, next).catch(() => false);
    if (done) return;
    setPinned(!next);
    toasts.show({ message: next ? "Couldn't pin the clipping." : "Couldn't unpin the clipping." });
  }

  const togglePin = () => void pin(!pinned);

  async function readAgain() {
    setReading(true);
    try {
      await reEnrichClippingAction(clippingId);
      router.refresh();
    } finally {
      setReading(false);
    }
  }

  useRegisterCurrentClipping({ title, url, pinned, togglePin });

  return (
    <div className="flex flex-wrap items-center gap-x-1 print:hidden">
      <Button variant="text" isDisabled={!online} onPress={togglePin}>
        {pinned ? <PinOff className="size-4.5" /> : <Pin className="size-4.5" />}
        {pinned ? "Unpin" : "Pin"}
      </Button>
      {canShare ? (
        <Button variant="text" onPress={() => void shareLinkWithToast({ title, url })}>
          <Share2 className="size-4.5" />
          Share
        </Button>
      ) : null}
      <Button variant="text" onPress={() => void copyLinkWithToast(url)}>
        <Copy className="size-4.5" />
        Copy link
      </Button>
      {status === "ready" ? (
        <Button
          variant="text"
          isPending={reading}
          isDisabled={!online}
          onPress={() => void readAgain()}
        >
          <RefreshCw className="size-4.5" />
          Read the page again
        </Button>
      ) : null}
    </div>
  );
}
