import { signOutAction } from "@/app/(app)/settings/actions.ts";
import { Button, Icon, LinkButton } from "@clippings/ui";

import { SettingsSection } from "./settings-section.tsx";

/** Who is signed in, signing out, and taking every clipping along as JSON. */
export function AccountSettings({ email }: { email: string }) {
  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        title="Signed in as"
        description={<span className="break-all">{email}</span>}
      >
        <form action={signOutAction}>
          <Button type="submit" variant="outlined">
            <Icon name="logout" />
            Sign out
          </Button>
        </form>
      </SettingsSection>

      <SettingsSection
        title="Export"
        description="Download all your clippings, with their notes and tags, as one JSON file."
      >
        <div>
          <LinkButton href="/api/export" download variant="tonal">
            <Icon name="download" />
            Export JSON
          </LinkButton>
        </div>
      </SettingsSection>
    </div>
  );
}
