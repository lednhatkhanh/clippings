"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { saveAppearanceAction } from "@/app/(app)/settings/actions.ts";
import type { Appearance, AppearanceKey } from "@clippings/shared";
import {
  appearanceTransitionFor,
  applyAppearance,
  Segment,
  SegmentedButtons,
  toasts,
  transitionAppearance,
  type AppearanceTransition,
} from "@clippings/ui";

import { PalettePicker } from "./palette-picker.tsx";
import { SettingsCard, SettingsRow } from "./settings-section.tsx";

/**
 * Mode, palette, contrast and density. A change shows at once on this device, is mirrored for
 * the no-flash script, and is saved to the user's settings so their other devices follow.
 */
export function AppearanceSettings({ initial }: { initial: Appearance }) {
  const [appearance, setAppearance] = useState(initial);
  // What the page shows, or is about to once a view transition runs its update, for a failed
  // save that has to be taken back later.
  const shown = useRef(initial);

  function show(next: Appearance, kind: AppearanceTransition) {
    // Set now: the view transition runs `update` a frame later, and a save can fail before that.
    shown.current = next;
    const update = () => {
      // The latest choice, so a transition that started before a revert doesn't undo it.
      const latest = shown.current;
      // Synchronous, so the view transition's new snapshot already shows the new selection.
      flushSync(() => setAppearance(latest));
      applyAppearance(latest);
    };
    transitionAppearance(update, { kind });
  }

  function change<K extends AppearanceKey>(key: K, value: Appearance[K]) {
    const previous = shown.current[key];
    if (previous === value) return;
    show({ ...shown.current, [key]: value }, appearanceTransitionFor(key));

    saveAppearanceAction({ [key]: value }).catch(() => {
      // Unsaved, the next page load would put the server's value back anyway: do it now, unless
      // the user has picked something else since.
      if (shown.current[key] === value)
        show({ ...shown.current, [key]: previous }, appearanceTransitionFor(key, { revert: true }));
      toasts.show({ message: "Couldn't save that setting. Try again." });
    });
  }

  return (
    <SettingsCard title="Appearance">
      <SettingsRow title="Mode" description="Light, dark, or whatever your device uses.">
        <SegmentedButtons
          aria-label="Mode"
          className="medium:w-auto"
          selectedKey={appearance.theme}
          onSelectionChange={(key) => change("theme", key as Appearance["theme"])}
        >
          <Segment id="system" icon={Monitor}>
            System
          </Segment>
          <Segment id="light" icon={Sun}>
            Light
          </Segment>
          <Segment id="dark" icon={Moon}>
            Dark
          </Segment>
        </SegmentedButtons>
      </SettingsRow>

      <SettingsRow
        stacked
        title="Accent"
        description="Tints buttons, selection and the paper's glow."
      >
        <PalettePicker
          value={appearance.palette}
          onChange={(palette) => change("palette", palette)}
        />
      </SettingsRow>

      <SettingsRow
        title="Contrast"
        description="System follows your device's contrast setting. More and Most make text and edges stronger."
      >
        <SegmentedButtons
          aria-label="Contrast"
          className="medium:w-auto"
          selectedKey={appearance.contrast}
          onSelectionChange={(key) => change("contrast", key as Appearance["contrast"])}
        >
          <Segment id="system">System</Segment>
          <Segment id="standard">Standard</Segment>
          <Segment id="medium">More</Segment>
          <Segment id="high">Most</Segment>
        </SegmentedButtons>
      </SettingsRow>

      <SettingsRow title="Density" description="Compact fits more clippings on the screen.">
        <SegmentedButtons
          aria-label="Density"
          className="medium:w-auto"
          selectedKey={appearance.density}
          onSelectionChange={(key) => change("density", key as Appearance["density"])}
        >
          <Segment id="comfortable">Comfortable</Segment>
          <Segment id="compact">Compact</Segment>
        </SegmentedButtons>
      </SettingsRow>
    </SettingsCard>
  );
}
