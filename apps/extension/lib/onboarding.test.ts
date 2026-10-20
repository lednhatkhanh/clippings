import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { openOnboarding } from "./onboarding.ts";

describe("the onboarding tab", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    // As the service worker registers it.
    fakeBrowser.runtime.onInstalled.addListener(openOnboarding);
  });

  const onboardingTabs = async () =>
    (await fakeBrowser.tabs.query({})).filter((tab) => tab.url?.endsWith("/onboarding.html"));

  it("opens once, on install", async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "install" });
    expect(await onboardingTabs()).toHaveLength(1);
  });

  it("stays shut on an update of the extension or of Chrome", async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "update", previousVersion: "0.0.0" });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "chrome_update" });
    expect(await onboardingTabs()).toHaveLength(0);
  });
});
