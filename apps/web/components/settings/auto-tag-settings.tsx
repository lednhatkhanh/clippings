"use client";

import { useRef, useState } from "react";

import { setAutoTagAction } from "@/app/(app)/settings/actions.ts";
import { Segment, SegmentedButtons, toasts } from "@clippings/ui";

import { SettingsCard, SettingsRow } from "./settings-section.tsx";

/**
 * The auto-tagging switch. It shows the choice at once and saves it, taking it back with a toast
 * when the save fails.
 */
export function AutoTagSettings({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  // The latest choice, so a failed save only undoes itself when nothing newer was picked.
  const latest = useRef(initial);

  function change(next: boolean) {
    if (latest.current === next) return;
    const previous = latest.current;
    latest.current = next;
    setOn(next);
    setAutoTagAction({ autoTag: next }).catch(() => {
      if (latest.current === next) {
        latest.current = previous;
        setOn(previous);
      }
      toasts.show({ message: "Couldn't save that setting. Try again." });
    });
  }

  return (
    <SettingsCard title="Auto-tagging">
      <SettingsRow
        title="Tag new clippings automatically"
        description="When on, the model puts your existing tags on a new clipping when it is sure they fit, and adds a new tag only when it is sure and none of yours does. Each one is marked on the clipping with an Undo. Anything less certain stays a suggestion. Off, nothing is added without you. On for new accounts; an account that existed before auto-tagging began starts off."
      >
        <SegmentedButtons
          aria-label="Tag new clippings automatically"
          className="medium:w-auto"
          selectedKey={on ? "on" : "off"}
          onSelectionChange={(key) => change(key === "on")}
        >
          <Segment id="on">On</Segment>
          <Segment id="off">Off</Segment>
        </SegmentedButtons>
      </SettingsRow>
    </SettingsCard>
  );
}
