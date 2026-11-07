"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { requestBriefNowAction } from "@/app/(app)/c/[id]/actions.ts";
import { Button, toasts } from "@clippings/ui";

/** Asks for the clipping's research brief to be written now ("Write it now", "Try again now"). */
export function BriefRequestButton({
  clippingId,
  variant = "paper",
  children,
}: {
  clippingId: string;
  variant?: "paper" | "text";
  children: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function request() {
    startTransition(async () => {
      const outcome = await requestBriefNowAction(clippingId).catch(() => null);
      if (!outcome) {
        toasts.show({ message: "Couldn't ask for the brief. Try again." });
      } else if (outcome.status === "limit_reached") {
        toasts.show({
          message: "You've used today's research jobs. Change the limit in Settings → Automation.",
        });
      } else if (outcome.status === "not_found") {
        toasts.show({ message: "That clipping is gone." });
      } else if (outcome.status === "failed") {
        toasts.show({
          message: "Couldn't start the brief. It's back in the queue for the next batch.",
        });
      } else if (outcome.status === "busy") {
        // Already on its way: show where it stands.
        router.refresh();
      }
    });
  }

  return (
    <Button variant={variant} isPending={pending} onPress={request}>
      {children}
    </Button>
  );
}
