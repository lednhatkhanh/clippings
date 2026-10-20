import { addSeconds, constructNow } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { formatIsoUtc } from "@clippings/shared";

import { isSignedIn } from "./auth.ts";
import type { PopupRequest } from "./messages.ts";
import { answerPopup } from "./popup-requests.ts";
import { enqueue, queuedSaves } from "./queue.ts";

/** What the service worker answers `message` with: undefined when it doesn't answer. */
async function ask(message: PopupRequest, senderId: string | undefined = browser.runtime.id) {
  const sendResponse = vi.fn();
  const answered = new Promise((resolve) => sendResponse.mockImplementation(resolve));
  const keepsOpen = answerPopup(message, { id: senderId }, sendResponse);
  return keepsOpen ? await answered : undefined;
}

beforeEach(async () => {
  fakeBrowser.reset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 })),
  );
  await browser.storage.local.set({
    clientId: "client-1",
    tokens: {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: formatIsoUtc(addSeconds(constructNow(undefined), 3000)),
    },
  });
  await enqueue({ url: "https://example.com/offline" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("answering the popup", () => {
  it("answers the extension's own pages", async () => {
    expect(await ask({ type: "status" })).toEqual({ signedIn: true, signInProblem: null });
  });

  it.each([
    ["another extension", "some-other-extension-id"],
    ["a sender with no id, such as a web page", undefined],
  ])("ignores a message from %s", async (_, senderId) => {
    const sendResponse = vi.fn();

    const keepsOpen = answerPopup({ type: "signOut" }, { id: senderId }, sendResponse);

    expect(keepsOpen).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
    expect(await isSignedIn()).toBe(true);
    expect(await queuedSaves()).toHaveLength(1);
  });

  it("signs out and forgets the saves made offline, so they can't go to the next account", async () => {
    expect(await ask({ type: "signOut" })).toEqual({ signedIn: false });

    expect(await isSignedIn()).toBe(false);
    expect(await queuedSaves()).toEqual([]);
  });
});
