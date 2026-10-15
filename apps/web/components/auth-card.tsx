import type { ReactNode } from "react";

/** The centered paper card shared by the sign-in and not-allowlisted states. */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4 py-8 text-on-surface">
      <div className="flex w-full max-w-100 flex-col items-center gap-6 rounded-xl bg-surface-container p-8 text-center">
        <span className="typescale-title-lg">Clippings</span>
        {children}
      </div>
    </main>
  );
}
