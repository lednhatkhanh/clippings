import type { Metadata } from "next";

import { AuthCard } from "@/components/auth-card.tsx";
import { NotebookIllustration } from "@clippings/ui";

import { RetryButton } from "./retry-button.tsx";

export const metadata: Metadata = { title: "Offline · Clippings", robots: { index: false } };

/**
 * What the service worker shows for a navigation the network can't answer. It is static and
 * outside the proxy, so the worker can precache it without a session, and it holds no user data.
 */
export default function OfflinePage() {
  return (
    <AuthCard>
      <NotebookIllustration className="h-auto w-50" />
      <h1 className="typescale-headline-sm">You&apos;re offline.</h1>
      <p className="typescale-body-md text-on-surface-variant">
        Your clippings will be here when you&apos;re back.
      </p>
      <RetryButton />
    </AuthCard>
  );
}
