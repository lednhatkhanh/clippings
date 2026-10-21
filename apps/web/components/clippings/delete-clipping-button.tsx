"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { useOnline } from "@/components/online-status.tsx";
import { Button } from "@clippings/ui";

import { useDeleteClipping } from "./deleted-clippings.tsx";

/** Deletes the clipping on the detail page and goes back to the list, where Undo waits. */
export function DeleteClippingButton({ clippingId }: { clippingId: string }) {
  const router = useRouter();
  const deleteClipping = useDeleteClipping();
  const online = useOnline();

  return (
    <Button
      variant="paper"
      aria-label="Delete clipping"
      isDisabled={!online}
      className="w-11"
      onPress={() => {
        deleteClipping(clippingId);
        router.push("/", { transitionTypes: ["nav-back"] });
      }}
    >
      <Trash2 className="size-4.5 text-danger" />
    </Button>
  );
}
