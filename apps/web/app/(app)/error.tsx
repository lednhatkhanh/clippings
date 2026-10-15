"use client";

import { useRouter } from "next/navigation";
import { startTransition } from "react";

import { Button } from "@clippings/ui";

/** The shell stays; only the page's content is replaced by this banner. */
export default function AppError({ reset }: { reset: () => void }) {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-180 py-4">
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-error-container px-4 py-3 text-on-error-container"
      >
        <span className="typescale-body-md">Couldn&apos;t load this page.</span>
        <Button
          variant="text"
          // A server error needs the server to run again, not just a client re-render.
          onPress={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
        >
          Retry
        </Button>
      </div>
    </div>
  );
}
