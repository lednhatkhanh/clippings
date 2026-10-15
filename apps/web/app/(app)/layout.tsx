import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AppShell } from "../../components/app-shell";
import { getSession } from "../../lib/auth/session";

async function SessionGate({ children }: { children: ReactNode }) {
  if (!(await getSession())) redirect("/sign-in");
  return children;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      {/* The shell prerenders; only the session check waits for the request. */}
      <Suspense fallback={null}>
        <SessionGate>{children}</SessionGate>
      </Suspense>
    </AppShell>
  );
}
