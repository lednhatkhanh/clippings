import { cache } from "react";

import { getPool } from "@/lib/db.ts";
import { createSettingsService, systemClock, type SettingsService } from "@clippings/db";

let service: SettingsService | undefined;

/** The user settings service on the shared pool. */
export function getSettings(): SettingsService {
  return (service ??= createSettingsService({ pool: getPool(), clock: systemClock }));
}

/**
 * The user's appearance settings. Deduplicated per request: the layout's sync and the Settings
 * page share one lookup.
 */
export const getAppearance = cache((userId: string) => getSettings().getSettings(userId));

/** Whether the user has tag suggestions on. Off until they turn it on in Settings. */
export const getSuggestTags = cache((userId: string) => getSettings().getSuggestTags(userId));

/** Whether auto-tagging is on for the user. Deduplicated per request. */
export const getAutoTag = cache((userId: string) => getSettings().getAutoTag(userId));

/** The user's daily spend cap and research-job limit. Deduplicated per request. */
export const getAutomation = cache((userId: string) => getSettings().getAutomationSettings(userId));

/** The user's "About me" text and research domains. Deduplicated per request. */
export const getResearchSettings = cache((userId: string) =>
  getSettings().getResearchSettings(userId),
);
