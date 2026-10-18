import { eq } from "drizzle-orm";
import type pg from "pg";

import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_KEYS,
  isAppearanceValue,
  type Appearance,
} from "@clippings/shared";

import type { Clock } from "../clippings/ports.ts";
import { createDatabase } from "../database.ts";
import { userSettings } from "../schema.ts";

export interface SettingsServiceDeps {
  pool: pg.Pool;
  clock: Clock;
}

export class InvalidSettingsError extends Error {
  constructor(key: string, value: unknown) {
    super(`Not an allowed ${key}: ${String(value)}`);
    this.name = "InvalidSettingsError";
  }
}

const appearanceColumns = {
  theme: userSettings.theme,
  palette: userSettings.palette,
  contrast: userSettings.contrast,
  density: userSettings.density,
};

/**
 * A user's settings. Every operation takes the acting user and scopes its queries by them.
 */
export function createSettingsService({ pool, clock }: SettingsServiceDeps) {
  const db = createDatabase(pool);

  /** The user's appearance settings, or the defaults when they have never changed one. */
  async function getSettings(userId: string): Promise<Appearance> {
    const [row] = await db
      .select(appearanceColumns)
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    return row ?? APPEARANCE_DEFAULTS;
  }

  /**
   * Saves the settings named in `changes`; the others keep their stored value, or the default for a
   * user with no row yet. Returns all of the user's settings as they now stand. Keys that aren't
   * settings are ignored; a value that isn't allowed throws `InvalidSettingsError` and saves nothing.
   */
  async function updateSettings(userId: string, changes: Partial<Appearance>): Promise<Appearance> {
    const given: Partial<Appearance> = {};
    for (const key of APPEARANCE_KEYS) {
      const value: unknown = changes[key];
      if (value === undefined) continue;
      if (!isAppearanceValue(key, value)) throw new InvalidSettingsError(key, value);
      Object.assign(given, { [key]: value });
    }

    const updatedAt = clock.now();
    const [saved] = await db
      .insert(userSettings)
      .values({ userId, ...given, updatedAt })
      .onConflictDoUpdate({ target: userSettings.userId, set: { ...given, updatedAt } })
      .returning(appearanceColumns);
    return saved!;
  }

  return { getSettings, updateSettings };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
