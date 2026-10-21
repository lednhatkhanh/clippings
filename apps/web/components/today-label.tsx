"use client";

import { constructNow, format } from "date-fns";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Today as a header's eyebrow says it ("Tuesday · 21 October"). The server can't know the reader's
 * day, so it renders nothing and the line appears after hydration.
 */
export function TodayLabel() {
  const today = useSyncExternalStore(
    subscribe,
    () => format(constructNow(undefined), "EEEE · d MMMM"),
    () => "",
  );
  return <>{today}</>;
}
