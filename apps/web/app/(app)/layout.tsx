import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AppShell } from "@/components/app-shell.tsx";
import { LoadError } from "@/components/load-error.tsx";
import { AppProviders } from "@/components/providers.tsx";
import { getSession } from "@/lib/auth/session.ts";

async function SessionGate({ children }: { children: ReactNode }) {
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch (error) {
    // Prerendering postpones and redirects travel as errors; only real failures reach the banner.
    unstable_rethrow(error);
    // The session lives in the database, so a database outage lands here, before any page runs.
    return (
      <div className="mx-auto max-w-180 py-4">
        <LoadError message="Couldn't load your account. Try again in a moment." />
      </div>
    );
  }
  if (!session) redirect("/sign-in");
  return children;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <AppShell>
        {/* The shell prerenders; only the session check waits for the request. */}
        <Suspense fallback={null}>
          <SessionGate>{children}</SessionGate>
        </Suspense>
      </AppShell>
    </AppProviders>
  );
}
