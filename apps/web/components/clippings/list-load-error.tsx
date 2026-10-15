"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@clippings/ui";

/** Shown in place of the list when it can't load; the rest of the page stays usable. */
export function ListLoadError() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-error-container px-4 py-3 text-on-error-container"
    >
      <span className="typescale-body-md">Couldn&apos;t load your clippings.</span>
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
