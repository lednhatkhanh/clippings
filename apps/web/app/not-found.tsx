import type { Metadata } from "next";

import { StatusPage } from "@/components/status-page.tsx";
import { ClippingsStackIllustration, LinkButton } from "@clippings/ui";

export const metadata: Metadata = { title: "Not found · Clippings" };

/** Any address the app doesn't have. It renders without the app shell, so it needs no session. */
export default function NotFound() {
  return (
    <main className="min-h-dvh bg-surface px-4 text-on-surface">
      <StatusPage
        illustration={<ClippingsStackIllustration className="h-auto w-50" />}
        title="This page isn't in the scrapbook."
        actions={
          <LinkButton variant="filled" href="/">
            Back to your clippings
          </LinkButton>
        }
      >
        The link may be mistyped, or the page has moved.
      </StatusPage>
    </main>
  );
}
