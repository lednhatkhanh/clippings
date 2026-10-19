"use client";

import { StatusPage } from "@/components/status-page.tsx";
import { Button, LinkButton } from "@clippings/ui";

/** A render error outside the signed-in app, such as on the sign-in page. */
export default function RootError({ retry }: { retry: () => void }) {
  return (
    <main className="min-h-dvh bg-surface px-4 text-on-surface">
      <StatusPage
        isAlert
        title="Something went wrong."
        actions={
          <>
            <Button variant="filled" onPress={retry}>
              Retry
            </Button>
            <LinkButton variant="text" href="/">
              Back to your clippings
            </LinkButton>
          </>
        }
      >
        This page couldn&apos;t be shown. Try again in a moment.
      </StatusPage>
    </main>
  );
}
