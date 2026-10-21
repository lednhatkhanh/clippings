import { Bookmark } from "lucide-react";
import type { ReactNode } from "react";

/** The centered paper card shared by the sign-in, consent and offline pages, on the ground. */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8 text-ink">
      <div className="flex w-full max-w-100 flex-col items-center gap-6 rounded-xl paper p-8 text-center">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-md accent-fill"
          >
            <Bookmark className="size-4.5" />
          </span>
          <span className="typescale-title-lg">Clippings</span>
        </div>
        {children}
      </div>
    </main>
  );
}
