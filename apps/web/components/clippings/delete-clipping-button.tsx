"use client";

import { useRouter } from "next/navigation";

import { Button, Icon } from "@clippings/ui";

import { useDeleteClipping } from "./deleted-clippings";

/** Deletes the clipping on the detail page and goes back to the list, where Undo waits. */
export function DeleteClippingButton({ clippingId }: { clippingId: string }) {
  const router = useRouter();
  const deleteClipping = useDeleteClipping();

  return (
    <Button
      variant="text"
      onPress={() => {
        deleteClipping(clippingId);
        router.push("/");
      }}
    >
      <Icon name="delete" />
      Delete
    </Button>
  );
}
