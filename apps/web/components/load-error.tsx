"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@clippings/ui";

/**
 * Shown in place of content that couldn't load, inside the app shell, so one failure doesn't
 * blank the page. Retry asks the server for the content again.
 */
export function LoadError({ message }: { message: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-error-container px-4 py-3 text-on-error-container"
    >
      <span className="typescale-body-md">{message}</span>
      <Button
        variant="text"
        isPending={isPending}
        onPress={() => startTransition(() => router.refresh())}
      >
        Retry
      </Button>
    </div>
  );
}
