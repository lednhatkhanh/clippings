import { constructNow } from "date-fns";
import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { LoadError } from "@/components/load-error.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import { PageTransition, RevealTransition } from "@/components/page-transition.tsx";
import { AccountSettings } from "@/components/settings/account-settings.tsx";
import { AppearanceSettings } from "@/components/settings/appearance-settings.tsx";
import {
  ConnectionsSettings,
  type ConnectionRow,
} from "@/components/settings/connections-settings.tsx";
import { ImportSettings } from "@/components/settings/import-settings.tsx";
import { KeyboardSettings } from "@/components/settings/keyboard-settings.tsx";
import { SuggestTagsSettings } from "@/components/settings/suggest-tags-settings.tsx";
import { clientDisplayName, getConnections } from "@/lib/auth/connections.ts";
import { getSession, signInRedirect } from "@/lib/auth/session.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import { formatLastUsed } from "@/lib/format-date.ts";
import { getAppearance, getSuggestTags } from "@/lib/settings/service.ts";
import { formatIsoUtc } from "@clippings/shared";
import type { Appearance } from "@clippings/shared";
import { Tab, TabList, TabPanel, TabPanels, Tabs } from "@clippings/ui";

export const metadata: Metadata = { title: "Settings · Clippings" };

async function SettingsTabs() {
  const session = await getSession();
  if (!session) redirect(await signInRedirect());

  let appearance: Appearance;
  let connections: ConnectionRow[];
  let suggestTags: boolean;
  let pendingImports: number;
  try {
    const [settings, connected, suggest, pending] = await Promise.all([
      getAppearance(session.user.id),
      getConnections().listConnections(session.user.id),
      getSuggestTags(session.user.id),
      getClippings().countPendingImports(session.user.id),
    ]);
    appearance = settings;
    suggestTags = suggest;
    pendingImports = pending;
    const now = constructNow(undefined);
    connections = connected.map((connection) => ({
      clientId: connection.clientId,
      name: clientDisplayName(connection),
      lastUsed: formatLastUsed(connection.lastUsedAt && formatIsoUtc(connection.lastUsedAt), now),
    }));
  } catch (error) {
    unstable_rethrow(error);
    return <LoadError message="Couldn't load your settings." />;
  }

  return (
    <Tabs>
      <TabList aria-label="Settings">
        <Tab id="appearance">Appearance</Tab>
        <Tab id="library">Library</Tab>
        <Tab id="connections">Connections</Tab>
        <Tab id="account">Account</Tab>
      </TabList>
      <TabPanels>
        <TabPanel id="appearance">
          <div className="flex flex-col gap-4">
            <AppearanceSettings initial={appearance} />
            <KeyboardSettings />
          </div>
        </TabPanel>
        <TabPanel id="library">
          <div className="flex flex-col gap-4">
            <SuggestTagsSettings initial={suggestTags} />
            <ImportSettings pendingImports={pendingImports} />
          </div>
        </TabPanel>
        <TabPanel id="connections">
          <ConnectionsSettings connections={connections} />
        </TabPanel>
        <TabPanel id="account">
          <AccountSettings email={session.user.email} />
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}

export default function SettingsPage() {
  return (
    <PageTransition>
      <div className="mx-auto max-w-220">
        <PageHeader title="Settings" eyebrow="Make it yours" />
        <Suspense fallback={null}>
          <RevealTransition>
            <SettingsTabs />
          </RevealTransition>
        </Suspense>
      </div>
    </PageTransition>
  );
}
