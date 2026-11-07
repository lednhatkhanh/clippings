import { eq } from "drizzle-orm";
import type pg from "pg";

import {
  APPEARANCE_DEFAULTS,
  AUTO_TAG_DEFAULT,
  APPEARANCE_KEYS,
  AUTOMATION_DEFAULTS,
  automationSettingsChangeSchema,
  isAppearanceValue,
  RESEARCH_DEFAULTS,
  researchSettingsChangeSchema,
  type Appearance,
  type AutomationSettings,
  type AutomationSettingsChange,
  type ResearchSettings,
  type ResearchSettingsChange,
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

  /** Whether the user has tag suggestions on. Off until they turn it on. */
  async function getSuggestTags(userId: string): Promise<boolean> {
    const [row] = await db
      .select({ on: userSettings.suggestTags })
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    return row?.on ?? false;
  }

  /** Turns the user's tag suggestions on or off, and returns the setting as it now stands. */
  async function setSuggestTags(userId: string, on: boolean): Promise<boolean> {
    const updatedAt = clock.now();
    const [saved] = await db
      .insert(userSettings)
      .values({ userId, suggestTags: on, updatedAt })
      .onConflictDoUpdate({ target: userSettings.userId, set: { suggestTags: on, updatedAt } })
      .returning({ on: userSettings.suggestTags });
    return saved!.on;
  }

  /** Whether auto-tagging is on: the stored choice, or the default for a user with no settings. */
  async function getAutoTag(userId: string): Promise<boolean> {
    const [row] = await db
      .select({ on: userSettings.autoTag })
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    return row?.on ?? AUTO_TAG_DEFAULT;
  }

  /** Turns the user's auto-tagging on or off, and returns the setting as it now stands. */
  async function setAutoTag(userId: string, on: boolean): Promise<boolean> {
    const updatedAt = clock.now();
    const [saved] = await db
      .insert(userSettings)
      .values({ userId, autoTag: on, updatedAt })
      .onConflictDoUpdate({ target: userSettings.userId, set: { autoTag: on, updatedAt } })
      .returning({ on: userSettings.autoTag });
    return saved!.on;
  }

  const automationColumns = {
    dailyCapMicros: userSettings.dailyCapMicros,
    researchJobsPerDay: userSettings.researchJobsPerDay,
  };

  /** The user's daily cap and research-job limit, or the defaults when they never changed one. */
  async function getAutomationSettings(userId: string): Promise<AutomationSettings> {
    const [row] = await db
      .select(automationColumns)
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    return row ?? AUTOMATION_DEFAULTS;
  }

  /**
   * Saves the cap and/or research-job limit named in `changes`; the other keeps its value.
   * Returns both as they now stand. A change that isn't valid (not a whole number, out of range,
   * an unknown key, empty) throws `InvalidSettingsError` and saves nothing.
   */
  async function updateAutomationSettings(
    userId: string,
    changes: AutomationSettingsChange,
  ): Promise<AutomationSettings> {
    const parsed = automationSettingsChangeSchema.safeParse(changes);
    if (!parsed.success) {
      throw new InvalidSettingsError("automation settings", parsed.error.issues[0]?.message);
    }
    const updatedAt = clock.now();
    const [saved] = await db
      .insert(userSettings)
      .values({ userId, ...parsed.data, updatedAt })
      .onConflictDoUpdate({ target: userSettings.userId, set: { ...parsed.data, updatedAt } })
      .returning(automationColumns);
    return saved!;
  }

  const researchColumns = {
    profile: userSettings.researchProfile,
    domains: userSettings.researchDomains,
  };

  /** The user's research profile and domains, or the defaults when they never changed one. */
  async function getResearchSettings(userId: string): Promise<ResearchSettings> {
    const [row] = await db
      .select(researchColumns)
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    return row ?? { ...RESEARCH_DEFAULTS, domains: [...RESEARCH_DEFAULTS.domains] };
  }

  /**
   * Saves the profile and/or domains named in `changes`; the other keeps its value. Domains are
   * trimmed and deduplicated, and an empty list turns research off. Returns both as they now
   * stand. A change that isn't valid (too long, too many domains, an unknown key, empty) throws
   * `InvalidSettingsError` and saves nothing.
   */
  async function updateResearchSettings(
    userId: string,
    changes: ResearchSettingsChange,
  ): Promise<ResearchSettings> {
    const parsed = researchSettingsChangeSchema.safeParse(changes);
    if (!parsed.success) {
      throw new InvalidSettingsError("research settings", parsed.error.issues[0]?.message);
    }
    const { profile, domains } = parsed.data;
    const given = {
      ...(profile === undefined ? {} : { researchProfile: profile }),
      ...(domains === undefined ? {} : { researchDomains: domains }),
    };
    const updatedAt = clock.now();
    const [saved] = await db
      .insert(userSettings)
      .values({ userId, ...given, updatedAt })
      .onConflictDoUpdate({ target: userSettings.userId, set: { ...given, updatedAt } })
      .returning(researchColumns);
    return saved!;
  }

  return {
    getSettings,
    updateSettings,
    getSuggestTags,
    setSuggestTags,
    getAutoTag,
    setAutoTag,
    getAutomationSettings,
    updateAutomationSettings,
    getResearchSettings,
    updateResearchSettings,
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
