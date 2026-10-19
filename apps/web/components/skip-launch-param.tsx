"use client";

import { useLaunchParam } from "./use-launch-param.ts";

/** Drops `?name` where the page has nothing for it to do, so it doesn't fire later. */
export function SkipLaunchParam({ name }: { name: string }) {
  useLaunchParam(name, () => {});
  return null;
}
