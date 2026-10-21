import { Download, LogOut } from "lucide-react";

import { signOutAction } from "@/app/(app)/settings/actions.ts";
import { Button, LinkButton } from "@clippings/ui";

import { InstallAppSettings } from "./install-app-settings.tsx";
import { SettingsCard, SettingsRow } from "./settings-section.tsx";

/** Who is signed in, signing out, installing the app, and taking every clipping along as JSON. */
export function AccountSettings({ email }: { email: string }) {
  return (
    <SettingsCard title="Account">
      <SettingsRow
        title={
          <>
            <span className="block typescale-body-sm font-normal text-ink-faint">Signed in as</span>
            <span className="break-all">{email}</span>
          </>
        }
      >
        <form action={signOutAction}>
          <Button type="submit" variant="paper">
            <LogOut className="size-4.5" />
            Sign out
          </Button>
        </form>
      </SettingsRow>

      <InstallAppSettings />

      <SettingsRow
        title="Export"
        description="Download all your clippings, with their notes and tags, as one JSON file."
      >
        <LinkButton href="/api/export" download variant="paper">
          <Download className="size-4.5" />
          Export JSON
        </LinkButton>
      </SettingsRow>
    </SettingsCard>
  );
}
