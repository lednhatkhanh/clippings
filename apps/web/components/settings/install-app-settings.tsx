"use client";

import { useSyncExternalStore } from "react";

import {
  getInstallOption,
  promptInstall,
  subscribeInstallOption,
} from "@/lib/pwa/install-prompt.ts";
import { Button, Icon } from "@clippings/ui";

import { SettingsSection } from "./settings-section.tsx";

/**
 * "Install app": Chromium's install dialog, or the Add to Home Screen steps in iOS and iPadOS
 * Safari. Hidden in the installed app and where the browser offers neither. The server can't know,
 * so it renders nothing and the row appears after hydration.
 */
export function InstallAppSettings() {
  const option = useSyncExternalStore(subscribeInstallOption, getInstallOption, () => null);

  if (!option) return null;
  return (
    <SettingsSection
      title="Install app"
      description={
        option === "prompt"
          ? "Open Clippings in its own window, from your dock, taskbar or home screen."
          : "Add Clippings to your Home Screen to open it in its own window."
      }
    >
      {option === "prompt" ? (
        <div>
          <Button variant="tonal" onPress={() => void promptInstall()}>
            <Icon name="install_desktop" />
            Install app
          </Button>
        </div>
      ) : (
        <ol className="flex list-decimal flex-col gap-2 ps-6 typescale-body-md">
          <li>
            Tap Share <Icon name="ios_share" /> in Safari&apos;s toolbar.
          </li>
          <li>Choose Add to Home Screen. You may need to scroll the list or tap More.</li>
          <li>Tap Add.</li>
        </ol>
      )}
    </SettingsSection>
  );
}
