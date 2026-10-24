import { afterEach, describe, expect, it, vi } from "vitest";

import { NetworkError, request } from "./request.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("answers what the server answered", async () => {
    vi.stubGlobal("fetch", async () => new Response("ok"));

    expect(await (await request("https://example.com", {})).text()).toBe("ok");
  });

  it.each([
    ["the network can't be reached", new TypeError("Failed to fetch")],
    ["the time runs out", new DOMException("The operation timed out.", "TimeoutError")],
    ["the request is aborted", new DOMException("Aborted", "AbortError")],
  ])("is a NetworkError when %s", async (_label, error) => {
    vi.stubGlobal("fetch", async () => {
      throw error;
    });

    await expect(request("https://example.com", {})).rejects.toBeInstanceOf(NetworkError);
  });

  it("lets any other error through as it is", async () => {
    const other = new RangeError("not about the network");
    vi.stubGlobal("fetch", async () => {
      throw other;
    });

    await expect(request("https://example.com", {})).rejects.toBe(other);
  });
});
