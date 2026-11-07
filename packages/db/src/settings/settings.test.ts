import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  APPEARANCE_DEFAULTS,
  AUTO_TAG_DEFAULT,
  AUTOMATION_DEFAULTS,
  RESEARCH_DEFAULTS,
} from "@clippings/shared";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import { InvalidSettingsError } from "./service.ts";

describe.skipIf(!TEST_DATABASE_URL)("settings service", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  it("gives a user who never changed anything the default appearance", async () => {
    const ana = await fixture.createUser("ana");

    expect(await fixture.settings.getSettings(ana)).toEqual(APPEARANCE_DEFAULTS);
  });

  it("saves a change and leaves the other settings at their defaults", async () => {
    const ana = await fixture.createUser("ana");

    const updated = await fixture.settings.updateSettings(ana, { theme: "dark" });

    expect(updated).toEqual({ ...APPEARANCE_DEFAULTS, theme: "dark" });
    expect(await fixture.settings.getSettings(ana)).toEqual(updated);
  });

  it("changes only what a later update names", async () => {
    const ana = await fixture.createUser("ana");
    await fixture.settings.updateSettings(ana, { theme: "dark", palette: "ink" });

    const updated = await fixture.settings.updateSettings(ana, { density: "compact" });

    expect(updated).toEqual({
      ...APPEARANCE_DEFAULTS,
      theme: "dark",
      palette: "ink",
      density: "compact",
    });
    expect(await fixture.settings.getSettings(ana)).toEqual(updated);
  });

  it("keeps users apart: one user's settings never show up for another", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");

    await fixture.settings.updateSettings(ana, { theme: "dark", contrast: "high" });
    await fixture.settings.updateSettings(ben, { palette: "ochre" });

    expect(await fixture.settings.getSettings(ana)).toEqual({
      ...APPEARANCE_DEFAULTS,
      theme: "dark",
      contrast: "high",
    });
    expect(await fixture.settings.getSettings(ben)).toEqual({
      ...APPEARANCE_DEFAULTS,
      palette: "ochre",
    });
  });

  it("rejects a value that is not allowed and changes nothing", async () => {
    const ana = await fixture.createUser("ana");
    await fixture.settings.updateSettings(ana, { theme: "dark" });

    await expect(
      fixture.settings.updateSettings(ana, { density: "compact", palette: "neon" as "ink" }),
    ).rejects.toBeInstanceOf(InvalidSettingsError);

    expect(await fixture.settings.getSettings(ana)).toEqual({
      ...APPEARANCE_DEFAULTS,
      theme: "dark",
    });
  });

  it("ignores keys that are not settings", async () => {
    const ana = await fixture.createUser("ana");

    const updated = await fixture.settings.updateSettings(ana, {
      theme: "light",
      fontSize: "huge",
    } as { theme: "light" });

    expect(updated).toEqual({ ...APPEARANCE_DEFAULTS, theme: "light" });
  });

  it("forgets a user's settings when the user is deleted", async () => {
    const ana = await fixture.createUser("ana");
    await fixture.settings.updateSettings(ana, { theme: "dark" });

    await fixture.deleteUser(ana);
    await fixture.createUser("ana");

    expect(await fixture.settings.getSettings("ana")).toEqual(APPEARANCE_DEFAULTS);
  });

  describe("automation limits", () => {
    it("start at $3 a day and 3 research jobs", async () => {
      const ana = await fixture.createUser("ana");

      expect(await fixture.settings.getAutomationSettings(ana)).toEqual({
        dailyCapMicros: 3_000_000,
        researchJobsPerDay: 3,
      });
      expect(AUTOMATION_DEFAULTS).toEqual(await fixture.settings.getAutomationSettings(ana));
    });

    it("change one at a time and leave the other, and appearance, alone", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.updateSettings(ana, { theme: "dark" });

      await fixture.settings.updateAutomationSettings(ana, { dailyCapMicros: 5_000_000 });
      const updated = await fixture.settings.updateAutomationSettings(ana, {
        researchJobsPerDay: 7,
      });

      expect(updated).toEqual({ dailyCapMicros: 5_000_000, researchJobsPerDay: 7 });
      expect(await fixture.settings.getAutomationSettings(ana)).toEqual(updated);
      expect((await fixture.settings.getSettings(ana)).theme).toBe("dark");
    });

    it.each([
      ["a negative cap", { dailyCapMicros: -1 }],
      ["a cap above $1,000", { dailyCapMicros: 1_000_000_001 }],
      ["a fractional cap", { dailyCapMicros: 1.5 }],
      ["a cap that is not a number", { dailyCapMicros: "3" }],
      ["a negative job limit", { researchJobsPerDay: -1 }],
      ["too many jobs", { researchJobsPerDay: 101 }],
      ["nothing", {}],
      ["a key that is not a setting", { dailyCapMicros: 1_000_000, theme: "dark" }],
    ])("refuse %s and save nothing", async (_name, change) => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.updateAutomationSettings(ana, { dailyCapMicros: 2_000_000 });

      await expect(
        fixture.settings.updateAutomationSettings(ana, change as { dailyCapMicros: number }),
      ).rejects.toBeInstanceOf(InvalidSettingsError);

      expect(await fixture.settings.getAutomationSettings(ana)).toEqual({
        dailyCapMicros: 2_000_000,
        researchJobsPerDay: 3,
      });
    });

    it("accept a cap of zero, which holds every model call", async () => {
      const ana = await fixture.createUser("ana");

      const updated = await fixture.settings.updateAutomationSettings(ana, { dailyCapMicros: 0 });

      expect(updated.dailyCapMicros).toBe(0);
    });

    it("keep users apart", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");

      await fixture.settings.updateAutomationSettings(ana, {
        dailyCapMicros: 9_000_000,
        researchJobsPerDay: 10,
      });

      expect(await fixture.settings.getAutomationSettings(ben)).toEqual(AUTOMATION_DEFAULTS);
    });
  });

  describe("research settings", () => {
    it("start with no profile and the shipping and logistics domains", async () => {
      const ana = await fixture.createUser("ana");

      expect(await fixture.settings.getResearchSettings(ana)).toEqual(RESEARCH_DEFAULTS);
    });

    it("keep the default domains for a user who only changed something else", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.updateSettings(ana, { theme: "dark" });

      expect(await fixture.settings.getResearchSettings(ana)).toEqual(RESEARCH_DEFAULTS);
    });

    it("change one at a time, leave the other and the rest alone, and normalize domains", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.updateSettings(ana, { theme: "dark" });

      await fixture.settings.updateResearchSettings(ana, { profile: "  Backend dev  " });
      const updated = await fixture.settings.updateResearchSettings(ana, {
        domains: [" Rust ", "rust", "ports"],
      });

      expect(updated).toEqual({ profile: "Backend dev", domains: ["Rust", "ports"] });
      expect(await fixture.settings.getResearchSettings(ana)).toEqual(updated);
      expect((await fixture.settings.getSettings(ana)).theme).toBe("dark");
      expect(await fixture.settings.getAutomationSettings(ana)).toEqual(AUTOMATION_DEFAULTS);
    });

    it("turn research off with an empty list of domains", async () => {
      const ana = await fixture.createUser("ana");

      const updated = await fixture.settings.updateResearchSettings(ana, { domains: [] });

      expect(updated).toEqual({ profile: "", domains: [] });
      expect(await fixture.settings.getResearchSettings(ana)).toEqual(updated);
    });

    it.each([
      ["a profile that is too long", { profile: "x".repeat(1001) }],
      ["too many domains", { domains: Array.from({ length: 11 }, (_, i) => `d${i}`) }],
      ["a domain that is too long", { domains: ["x".repeat(61)] }],
      ["nothing", {}],
      ["a key that is not a setting", { profile: "p", theme: "dark" }],
    ])("refuse %s and save nothing", async (_name, change) => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.updateResearchSettings(ana, { profile: "Kept", domains: ["a"] });

      await expect(
        fixture.settings.updateResearchSettings(ana, change as { profile: string }),
      ).rejects.toBeInstanceOf(InvalidSettingsError);

      expect(await fixture.settings.getResearchSettings(ana)).toEqual({
        profile: "Kept",
        domains: ["a"],
      });
    });

    it("keep users apart", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");

      await fixture.settings.updateResearchSettings(ana, { profile: "Ana", domains: [] });

      expect(await fixture.settings.getResearchSettings(ben)).toEqual(RESEARCH_DEFAULTS);
    });
  });

  describe("auto-tagging", () => {
    it("is on for a user who never chose, and a choice sticks without touching the other settings", async () => {
      const ana = await fixture.createUser("ana");
      expect(await fixture.settings.getAutoTag(ana)).toBe(AUTO_TAG_DEFAULT);
      expect(AUTO_TAG_DEFAULT).toBe(true);

      expect(await fixture.settings.setAutoTag(ana, false)).toBe(false);

      expect(await fixture.settings.getAutoTag(ana)).toBe(false);
      expect(await fixture.settings.getSuggestTags(ana)).toBe(false);
      expect(await fixture.settings.getSettings(ana)).toEqual(APPEARANCE_DEFAULTS);
      expect(await fixture.settings.getAutomationSettings(ana)).toEqual(AUTOMATION_DEFAULTS);
    });

    it("is not changed by saving suggestions or appearance, and keeps users apart", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await fixture.settings.setAutoTag(ana, false);

      await fixture.settings.setSuggestTags(ana, true);
      await fixture.settings.updateSettings(ana, { theme: "dark" });

      expect(await fixture.settings.getAutoTag(ana)).toBe(false);
      expect(await fixture.settings.getAutoTag(ben)).toBe(true);
    });
  });
});
