import type { ReactNode } from "react";

/**
 * A whole page that stands in for one that can't be shown, such as a missing page or a failed
 * render: an illustration, a heading, a line of explanation and what to do next.
 */
export function StatusPage({
  illustration,
  title,
  children,
  actions,
  isAlert = false,
}: {
  illustration?: ReactNode;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  /** Announces the page as it appears, for a failure that replaced what the user expected. */
  isAlert?: boolean;
}) {
  return (
    <section
      role={isAlert ? "alert" : undefined}
      className="mx-auto my-8 flex w-full max-w-120 flex-col items-center gap-4 rounded-xl paper px-6 py-12 text-center"
    >
      {illustration}
      <h1 className="typescale-headline-sm text-balance">{title}</h1>
      <p className="typescale-body-lg text-pretty text-ink-muted">{children}</p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">{actions}</div>
    </section>
  );
}
