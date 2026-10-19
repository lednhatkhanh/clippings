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
}: {
  illustration?: ReactNode;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section className="mx-auto flex max-w-120 flex-col items-center gap-4 py-16 text-center">
      {illustration}
      <h1 className="typescale-headline-sm text-balance">{title}</h1>
      <p className="typescale-body-lg text-pretty text-on-surface-variant">{children}</p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">{actions}</div>
    </section>
  );
}
