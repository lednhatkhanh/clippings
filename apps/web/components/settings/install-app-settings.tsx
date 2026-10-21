"use client";

import { MonitorDown, Share } from "lucide-react";
import { useSyncExternalStore } from "react";

import {
  getInstallOption,
  promptInstall,
  subscribeInstallOption,
} from "@/lib/pwa/install-prompt.ts";
import { Button } from "@clippings/ui";

import { SettingsRow } from "./settings-section.tsx";

/**
 * "Install app": Chromium's install dialog, or the Add to Home Screen steps in iOS and iPadOS
 * Safari. Hidden in the installed app and where the browser offers neither. The server can't know,
 * so it renders nothing and the row appears after hydration.
 */
export function InstallAppSettings() {
  const option = useSyncExternalStore(subscribeInstallOption, getInstallOption, () => null);

  if (!option) return null;
  return (
    <SettingsRow
      stacked={option !== "prompt"}
      title="Install app"
      description={
        option === "prompt"
          ? "Open Clippings in its own window, from your dock, taskbar or home screen."
          : "Add Clippings to your Home Screen to open it in its own window."
      }
    >
      {option === "prompt" ? (
        <Button variant="paper" onPress={() => void promptInstall()}>
          <MonitorDown className="size-4.5" />
          Install app
        </Button>
      ) : (
        <ol className="flex list-decimal flex-col gap-2 ps-6 typescale-body-md text-ink-muted">
          <li>
            Tap Share <Share className="inline size-4 align-text-bottom" /> in Safari&apos;s
            toolbar.
          </li>
          <li>Choose Add to Home Screen. You may need to scroll the list or tap More.</li>
          <li>Tap Add.</li>
        </ol>
      )}
    </SettingsRow>
  );
}
