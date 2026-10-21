import { describe, expect, it } from "vitest";

import { copyLink, shareLink, type ShareEnv } from "./share.ts";

const link = { title: "A page", url: "https://example.com/a" };

function env(overrides: Partial<ShareEnv> = {}) {
  const calls = { shared: [] as unknown[], copied: [] as string[] };
  const fake: ShareEnv = {
    share: async (sent) => void calls.shared.push(sent),
    copy: async (text) => void calls.copied.push(text),
    ...overrides,
  };
  return { fake, calls };
}

const abort = () => Object.assign(new Error("closed"), { name: "AbortError" });

describe("shareLink", () => {
  it("shares only the title and the address", async () => {
    const { fake, calls } = env();
    expect(await shareLink({ ...link, extra: "note" } as typeof link, fake)).toBe("shared");
    expect(calls.shared).toEqual([link]);
    expect(calls.copied).toEqual([]);
  });

  it("ignores a closed share sheet", async () => {
    const { fake, calls } = env({ share: async () => Promise.reject(abort()) });
    expect(await shareLink(link, fake)).toBe("cancelled");
    expect(calls.copied).toEqual([]);
  });

  it("copies the address when sharing fails for another reason", async () => {
    const { fake, calls } = env({ share: async () => Promise.reject(new Error("denied")) });
    expect(await shareLink(link, fake)).toBe("copied");
    expect(calls.copied).toEqual([link.url]);
  });

  it("copies the address when there is no share sheet", async () => {
    const { fake, calls } = env({ share: undefined });
    expect(await shareLink(link, fake)).toBe("copied");
    expect(calls.copied).toEqual([link.url]);
  });

  it("fails when sharing and copying both fail", async () => {
    const { fake } = env({
      share: async () => Promise.reject(new Error("denied")),
      copy: async () => Promise.reject(new Error("blocked")),
    });
    expect(await shareLink(link, fake)).toBe("failed");
  });
});

describe("copyLink", () => {
  it("copies the address", async () => {
    const { fake, calls } = env();
    expect(await copyLink(link.url, fake)).toBe("copied");
    expect(calls.copied).toEqual([link.url]);
  });

  it("fails when the browser refuses", async () => {
    const { fake } = env({ copy: async () => Promise.reject(new Error("blocked")) });
    expect(await copyLink(link.url, fake)).toBe("failed");
  });
});
