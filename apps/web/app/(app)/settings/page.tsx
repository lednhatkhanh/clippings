import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { LoadError } from "@/components/load-error.tsx";
import { PageTransition, RevealTransition } from "@/components/page-transition.tsx";
import { AccountSettings } from "@/components/settings/account-settings.tsx";
import { AppearanceSettings } from "@/components/settings/appearance-settings.tsx";
import { getSession } from "@/lib/auth/session.ts";
import { getAppearance } from "@/lib/settings/service.ts";
import type { Appearance } from "@clippings/shared";
import { Tab, TabList, TabPanel, TabPanels, Tabs } from "@clippings/ui";

export const metadata: Metadata = { title: "Settings · Clippings" };

async function SettingsTabs() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  let appearance: Appearance;
  try {
    appearance = await getAppearance(session.user.id);
  } catch (error) {
    unstable_rethrow(error);
    return <LoadError message="Couldn't load your settings." />;
  }

  return (
    <Tabs>
      <TabList aria-label="Settings">
        <Tab id="appearance">Appearance</Tab>
        <Tab id="account">Account</Tab>
      </TabList>
      <TabPanels>
        <TabPanel id="appearance">
          <AppearanceSettings initial={appearance} />
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
      <div className="mx-auto max-w-180">
        <h1 className="py-4 typescale-headline-sm">Settings</h1>
        <Suspense fallback={null}>
          <RevealTransition>
            <SettingsTabs />
          </RevealTransition>
        </Suspense>
      </div>
    </PageTransition>
  );
}
