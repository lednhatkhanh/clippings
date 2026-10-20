import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth-card.tsx";
import { LetterboxIllustration } from "@clippings/ui";

export const metadata: Metadata = { title: "Not connected · Clippings", robots: { index: false } };

/** Why the connection ended here, by the `reason` the consent flow passes. */
const REASONS: Record<string, string> = {
  denied: "You chose not to connect.",
  private: "That account isn't on this Clippings' list.",
  expired: "The request expired. Connect again from Claude.",
  failed: "Something went wrong while connecting. Try again from Claude.",
};

async function Reason({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <p className="typescale-body-md text-on-surface-variant">
      {REASONS[reason ?? ""] ?? REASONS.failed}
    </p>
  );
}

/**
 * Where a denied or failed OAuth connection ends. It has nothing to act on: Claude starts a new
 * connection, so the page only says what happened.
 */
export default function ConnectionClosedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  return (
    <AuthCard>
      <LetterboxIllustration className="h-auto w-50" />
      <h1 className="typescale-headline-sm">Claude wasn&apos;t connected.</h1>
      <Suspense fallback={null}>
        <Reason searchParams={searchParams} />
      </Suspense>
      <p className="typescale-body-md text-on-surface-variant">You can close this tab.</p>
    </AuthCard>
  );
}
