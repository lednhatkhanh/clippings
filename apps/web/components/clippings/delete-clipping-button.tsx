"use client";

import { useRouter } from "next/navigation";

import { useOnline } from "@/components/online-status.tsx";
import { Button, Icon } from "@clippings/ui";

import { useDeleteClipping } from "./deleted-clippings.tsx";

/** Deletes the clipping on the detail page and goes back to the list, where Undo waits. */
export function DeleteClippingButton({ clippingId }: { clippingId: string }) {
  const router = useRouter();
  const deleteClipping = useDeleteClipping();
  const online = useOnline();

  return (
    <Button
      variant="text"
      isDisabled={!online}
      onPress={() => {
        deleteClipping(clippingId);
        router.push("/", { transitionTypes: ["nav-back"] });
      }}
    >
      <Icon name="delete" />
      Delete
    </Button>
  );
}
