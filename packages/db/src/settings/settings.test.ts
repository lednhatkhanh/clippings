import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APPEARANCE_DEFAULTS } from "@clippings/shared";

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
});
