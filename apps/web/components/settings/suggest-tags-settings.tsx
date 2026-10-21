"use client";

import { useRef, useState } from "react";

import { setSuggestTagsAction } from "@/app/(app)/settings/actions.ts";
import { Segment, SegmentedButtons, toasts } from "@clippings/ui";

import { SettingsCard, SettingsRow } from "./settings-section.tsx";

/**
 * The tag suggestions switch. It shows the choice at once and saves it, taking it back with a
 * toast when the save fails.
 */
export function SuggestTagsSettings({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  // The latest choice, so a failed save only undoes itself when nothing newer was picked.
  const latest = useRef(initial);

  function change(next: boolean) {
    if (latest.current === next) return;
    const previous = latest.current;
    latest.current = next;
    setOn(next);
    setSuggestTagsAction(next).catch(() => {
      if (latest.current === next) {
        latest.current = previous;
        setOn(previous);
      }
      toasts.show({ message: "Couldn't save that setting. Try again." });
    });
  }

  return (
    <SettingsCard title="Tags">
      <SettingsRow
        title="Suggest tags"
        description="Off by default. When on, new clippings get suggested tags drawn from your existing ones, which you accept or dismiss. Turning it on sends your tag names to the model along with each page it reads."
      >
        <SegmentedButtons
          aria-label="Suggest tags"
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
