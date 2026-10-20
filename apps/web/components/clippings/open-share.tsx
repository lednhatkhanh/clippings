"use client";

import { useEffect, useEffectEvent, useRef } from "react";

import { replaceAddress } from "@/components/use-launch-param.ts";
import type { SharedLink } from "@clippings/shared";
import { toasts } from "@clippings/ui";

import { useOpenNewClipping } from "./new-clipping-dialog.tsx";

/** The words shared with a link, as a quoted note: each line starts with `> `. */
const asQuote = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");

/**
 * Opens "New clipping" with what was shared, or says there was no link, then drops the share from
 * the address, so a reload doesn't open it again. It never saves: any site can link to `/share`.
 */
export function OpenShare({ link }: { link: SharedLink }) {
  const open = useOpenNewClipping();
  // Once per visit, even when Strict Mode runs the effect twice.
  const handled = useRef(false);

  const launch = useEffectEvent(() => {
    if (handled.current) return;
    handled.current = true;
    replaceAddress("/");
    if (link.ok) {
      open({ url: link.url, note: link.quote ? asQuote(link.quote) : undefined });
    } else {
      toasts.show({ message: "Nothing to save: the share had no link." });
    }
  });
  useEffect(() => launch(), []);

  return null;
}
