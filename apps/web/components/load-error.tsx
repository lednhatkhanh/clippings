"use client";

import { CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "react-aria-components";

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
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-danger-soft py-2.5 ps-4 pe-2.5 text-on-danger-soft"
    >
      <span className="flex items-center gap-2.5 typescale-body-md">
        <CircleAlert className="size-5 shrink-0" />
        {message}
      </span>
      <Button
        isPending={isPending}
        onPress={() => startTransition(() => router.refresh())}
        className="state-layer flex h-11 cursor-default items-center rounded-md px-4 typescale-label-lg data-pending:opacity-40 medium:h-10"
      >
        Retry
      </Button>
    </div>
  );
}
