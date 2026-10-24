import { afterEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";

import { ask } from "./messages.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ask", () => {
  it("answers what the service worker replied", async () => {
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(async () => ({ signedIn: true }));

    expect(await ask({ type: "signIn" })).toEqual({ signedIn: true });
  });

  it("answers undefined when the service worker failed to answer, for the page to show its error", async () => {
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(async () => undefined);

    expect(await ask({ type: "status" })).toBeUndefined();
  });

  it("answers undefined when the service worker couldn't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(browser.runtime, "sendMessage").mockRejectedValue(
      new Error("Could not establish connection. Receiving end does not exist."),
    );

    expect(await ask({ type: "status" })).toBeUndefined();
  });
});
