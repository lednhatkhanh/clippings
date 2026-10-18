import { unstable_rethrow } from "next/navigation";

import { getAppearance } from "@/lib/settings/service.ts";
import type { Appearance } from "@clippings/shared";

import { ApplyAppearance } from "./apply-appearance.tsx";

/** The signed-in user's saved appearance, applied on this device. Renders nothing. */
export async function AppearanceSync({ userId }: { userId: string }) {
  let appearance: Appearance;
  try {
    appearance = await getAppearance(userId);
  } catch (error) {
    unstable_rethrow(error);
    // The device keeps what it has; the page itself still loads.
    console.error("Couldn't load the appearance settings", error);
    return null;
  }
  return <ApplyAppearance {...appearance} />;
}
