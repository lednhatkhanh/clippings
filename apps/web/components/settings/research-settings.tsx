"use client";

import { useState, useTransition } from "react";

import { saveResearchSettingsAction } from "@/app/(app)/settings/actions.ts";
import {
  MAX_RESEARCH_PROFILE_LENGTH,
  parseResearchDomains,
  type ResearchSettings as Research,
} from "@clippings/shared";
import { Button, TextField, toasts } from "@clippings/ui";

import { SettingsCard, SettingsRow } from "./settings-section.tsx";

/**
 * What research briefs are aimed at: who the user is, and the domains a save must be in for a
 * brief to be written. An empty list turns research off.
 */
export function ResearchSettings({ initial }: { initial: Research }) {
  const [saved, setSaved] = useState(initial);
  const [profile, setProfile] = useState(initial.profile);
  const [domains, setDomains] = useState(initial.domains.join(", "));
  const [pending, startTransition] = useTransition();

  const parsedDomains = parseResearchDomains(domains);
  const unchanged =
    profile.trim() === saved.profile &&
    parsedDomains.length === saved.domains.length &&
    parsedDomains.every((domain, index) => domain === saved.domains[index]);

  function save() {
    startTransition(async () => {
      const result = await saveResearchSettingsAction({ profile, domains }).catch(() => null);
      if (!result) {
        toasts.show({ message: "Couldn't save the research settings. Try again." });
      } else if (!result.ok) {
        toasts.show({ message: result.message });
      } else {
        setSaved(result.value);
        setProfile(result.value.profile);
        setDomains(result.value.domains.join(", "));
        toasts.show({
          message:
            result.value.domains.length === 0 ? "Research is off" : "Research settings saved",
        });
      }
    });
  }

  return (
    <SettingsCard title="Research">
      <SettingsRow
        stacked
        title="Research briefs"
        description="A research brief is written for saves in these domains: it looks the topic up on the web and cites its sources. Leave the list empty to turn research off. How many are written a day is set under Limits, below."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <TextField
            label="About me"
            multiline
            rows={3}
            maxLength={MAX_RESEARCH_PROFILE_LENGTH}
            placeholder="Developer at a shipping company, backend focus"
            value={profile}
            onChange={setProfile}
          />
          <TextField
            label="Research domains"
            placeholder="shipping, logistics"
            value={domains}
            onChange={setDomains}
          />
          <Button type="submit" isDisabled={pending || unchanged} className="self-start">
            Save
          </Button>
        </form>
      </SettingsRow>
    </SettingsCard>
  );
}
