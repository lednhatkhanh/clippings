"use client";

import { StatusPage } from "@/components/status-page.tsx";
import { Button } from "@clippings/ui";

/** The shell stays; only the page's content is replaced. Retry renders it on the server again. */
export default function AppError({ retry }: { retry: () => void }) {
  return (
    <StatusPage
      isAlert
      title="Something went wrong."
      actions={
        <Button variant="filled" onPress={retry}>
          Retry
        </Button>
      }
    >
      This page couldn&apos;t be shown. Try again in a moment.
    </StatusPage>
  );
}
