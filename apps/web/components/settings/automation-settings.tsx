"use client";

import { useState, useTransition } from "react";

import { saveAutomationSettingsAction } from "@/app/(app)/settings/actions.ts";
import {
  dollarsFieldValue,
  formatDollars,
  parseCount,
  parseDollars,
} from "@/lib/settings/automation.ts";
import type { AutomationSettings, SpendSummary } from "@clippings/shared";
import { Button, TextField, toasts } from "@clippings/ui";

import { SettingsCard, SettingsRow } from "./settings-section.tsx";

/**
 * What the app has spent on model calls and the limits on it: today's and this month's spend (UTC)
 * from the ledger, and the daily cap and research-job limit, which are editable. Past the cap the
 * app stops calling the models until the next UTC day; saves wait, and nothing is lost.
 */
export function AutomationSettings({
  spend,
  initial,
}: {
  spend: SpendSummary;
  initial: AutomationSettings;
}) {
  const [saved, setSaved] = useState(initial);
  const [cap, setCap] = useState(dollarsFieldValue(initial.dailyCapMicros));
  const [jobs, setJobs] = useState(String(initial.researchJobsPerDay));
  const [pending, startTransition] = useTransition();

  const capMicros = parseDollars(cap);
  const jobCount = parseCount(jobs);
  const capProblem = capMicros === null ? "Enter an amount in dollars, such as 3 or 2.50." : null;
  const jobsProblem = jobCount === null ? "Enter a whole number, such as 3." : null;
  const unchanged = capMicros === saved.dailyCapMicros && jobCount === saved.researchJobsPerDay;

  function save() {
    if (capMicros === null || jobCount === null) return;
    startTransition(async () => {
      const result = await saveAutomationSettingsAction({
        dailyCapMicros: capMicros,
        researchJobsPerDay: jobCount,
      }).catch(() => null);
      if (!result) {
        toasts.show({ message: "Couldn't save those limits. Try again." });
      } else if (!result.ok) {
        toasts.show({ message: result.message });
      } else {
        setSaved(result.value);
        toasts.show({ message: "Limits saved" });
      }
    });
  }

  return (
    <SettingsCard title="Automation">
      <SettingsRow
        title="Spent today"
        description={`The day runs on UTC and the cap is ${formatDollars(saved.dailyCapMicros)}. Once it is reached, new saves wait as pending and are read the next day.`}
      >
        <div className="typescale-title-md tabular-nums">{formatDollars(spend.todayMicros)}</div>
      </SettingsRow>
      <SettingsRow title="Spent this month" description="Model calls since the 1st, UTC.">
        <div className="typescale-title-md tabular-nums">{formatDollars(spend.monthMicros)}</div>
      </SettingsRow>
      <SettingsRow
        stacked
        title="Limits"
        description="Background work stops at 80% of the daily cap, so saves keep being read to the end of it. A cap of 0 turns the models off."
      >
        <form
          className="flex flex-col gap-4 medium:flex-row medium:items-start"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <TextField
            label="Daily cap (dollars)"
            inputMode="decimal"
            value={cap}
            onChange={setCap}
            errorMessage={capProblem ?? undefined}
            className="medium:w-48"
          />
          <TextField
            label="Research jobs a day"
            inputMode="numeric"
            value={jobs}
            onChange={setJobs}
            errorMessage={jobsProblem ?? undefined}
            className="medium:w-48"
          />
          <Button
            type="submit"
            isDisabled={pending || unchanged || capMicros === null || jobCount === null}
            className="medium:mt-6"
          >
            Save limits
          </Button>
        </form>
      </SettingsRow>
    </SettingsCard>
  );
}
