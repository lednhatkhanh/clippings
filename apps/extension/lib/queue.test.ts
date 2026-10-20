import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import {
  enqueue,
  MAX_FAILURES,
  queuedSaves,
  RETRY_ALARM,
  sendQueued,
  type QueuedSave,
  type SendOutcome,
} from "./queue.ts";

const urls = async () => (await queuedSaves()).map((save) => save.url);

describe("the offline queue", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("keeps one save per page and selection, however the address is written", async () => {
    await enqueue({ url: "https://example.com/a?utm_source=feed" });
    await enqueue({ url: "https://EXAMPLE.com/a/#top" });
    await enqueue({ url: "https://example.com/a", quote: "a line" });
    await enqueue({ url: "https://example.com/a", quote: "a line" });
    await enqueue({ url: "https://example.com/b" });

    const saves = await queuedSaves();
    expect(saves.map(({ url, quote }) => ({ url, quote }))).toEqual([
      { url: "https://example.com/a?utm_source=feed", quote: undefined },
      { url: "https://example.com/a", quote: "a line" },
      { url: "https://example.com/b", quote: undefined },
    ]);
    expect(new Set(saves.map((save) => save.id)).size).toBe(3);
  });

  it("keeps the queue in extension storage, so it outlives the service worker", async () => {
    await enqueue({ url: "https://example.com/a" });
    expect(await browser.storage.local.get("offlineSaves")).toMatchObject({
      offlineSaves: [{ url: "https://example.com/a", failures: 0 }],
    });
  });

  it("sends each save once, oldest first, and empties the queue", async () => {
    await enqueue({ url: "https://example.com/a" });
    await enqueue({ url: "https://example.com/b" });
    const send = vi.fn(async (_save: QueuedSave): Promise<SendOutcome> => "sent");

    await sendQueued(send);
    await sendQueued(send);

    expect(send.mock.calls.map(([save]) => save.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(await queuedSaves()).toEqual([]);
  });

  it("sends a save once when a second run starts while the first is sending", async () => {
    await enqueue({ url: "https://example.com/a" });
    let finish: (outcome: SendOutcome) => void = () => undefined;
    const send = vi.fn(
      () =>
        new Promise<SendOutcome>((resolve) => {
          finish = resolve;
        }),
    );

    const first = sendQueued(send);
    const second = sendQueued(send);
    // The browser's `online` event and the retry alarm can both fire; and the user can save the
    // same page again while it is being sent.
    await enqueue({ url: "https://example.com/a" });
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    finish("sent");
    await Promise.all([first, second]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(await queuedSaves()).toEqual([]);
  });

  it("keeps saves while offline or signed out, and stops there to keep their order", async () => {
    await enqueue({ url: "https://example.com/a" });
    await enqueue({ url: "https://example.com/b" });
    const send = vi.fn(async (): Promise<SendOutcome> => "later");

    await sendQueued(send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(await urls()).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect((await queuedSaves())[0]?.failures).toBe(0);
  });

  it("drops a save the server refuses, and gives up on one after repeated failures", async () => {
    await enqueue({ url: "https://example.com/refused" });
    await enqueue({ url: "https://example.com/broken" });
    const send = vi.fn(async (save: QueuedSave): Promise<SendOutcome> =>
      save.url.endsWith("refused") ? "drop" : "failed",
    );

    for (let run = 1; run < MAX_FAILURES; run += 1) await sendQueued(send);
    expect(await queuedSaves()).toMatchObject([
      { url: "https://example.com/broken", failures: MAX_FAILURES - 1 },
    ]);

    await sendQueued(send);
    expect(await queuedSaves()).toEqual([]);
  });

  it("sets the retry alarm while saves wait, and clears it once they're sent", async () => {
    await enqueue({ url: "https://example.com/a" });
    expect(await browser.alarms.get(RETRY_ALARM)).toMatchObject({ periodInMinutes: 0.5 });

    await sendQueued(async () => "sent");
    expect(await browser.alarms.get(RETRY_ALARM)).toBeUndefined();
  });
});
