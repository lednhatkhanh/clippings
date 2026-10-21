"use client";

import { useSyncExternalStore } from "react";

import {
  characterShortcutsOn,
  setCharacterShortcuts,
  subscribeCharacterShortcuts,
} from "@/lib/keyboard/preference.ts";
import { Segment, SegmentedButtons } from "@clippings/ui";

import { SettingsCard, SettingsRow } from "./settings-section.tsx";

/** Turns the single-key shortcuts on or off on this device (WCAG 2.1.4). */
export function KeyboardSettings() {
  const on = useSyncExternalStore(subscribeCharacterShortcuts, characterShortcutsOn, () => true);

  return (
    <SettingsCard title="Keyboard">
      <SettingsRow
        title="Single-key shortcuts"
        description="Keys like / to search and N for a new clipping. Turn them off if you use speech input. On this device only."
      >
        <SegmentedButtons
          aria-label="Single-key shortcuts"
          className="medium:w-auto"
          selectedKey={on ? "on" : "off"}
          onSelectionChange={(key) => setCharacterShortcuts(key === "on")}
        >
          <Segment id="on">On</Segment>
          <Segment id="off">Off</Segment>
        </SegmentedButtons>
      </SettingsRow>
    </SettingsCard>
  );
}
