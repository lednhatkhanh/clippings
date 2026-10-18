import type { ReactNode } from "react";

/** One setting on the Settings page: a heading, what it does, then its controls. */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="typescale-title-md">{title}</h2>
        <div className="typescale-body-md text-on-surface-variant">{description}</div>
      </div>
      {children}
    </section>
  );
}
