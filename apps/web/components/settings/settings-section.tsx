import type { ReactNode } from "react";

/** One group of settings on the Settings page: a sheet of paper, a serif title, then its rows. */
export function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg-increased paper px-5 pt-5 pb-1 medium:px-6">
      <h2 className="typescale-title-lg">{title}</h2>
      <div className="flex flex-col divide-y divide-line">{children}</div>
    </section>
  );
}

/**
 * One setting in a `SettingsCard`: what it is and does on the left, its control on the right.
 * A `stacked` row puts the control below, full width, for a wide one such as the accent picker.
 */
export function SettingsRow({
  title,
  description,
  stacked = false,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  stacked?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={
        stacked
          ? "flex flex-col gap-4 py-4.5"
          : "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4.5"
      }
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="typescale-title-sm">{title}</div>
        {description ? <div className="typescale-body-sm text-ink-faint">{description}</div> : null}
      </div>
      {children}
    </div>
  );
}
