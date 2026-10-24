import { describe, expect, it, vi } from "vitest";

import { REJECTED_EMAIL_COOKIE, createUserValidator } from "./validate-user.ts";

function setup(allowed: string) {
  const setCookie = vi.fn();
  const validate = createUserValidator({ allowedEmails: allowed });
  // `verified` is spread so that passing `undefined` explicitly differs from passing nothing.
  const run = (email: string | undefined, ...verified: [unknown?]) =>
    validate(
      {
        user: { email, emailVerified: (verified.length ? verified[0] : true) as boolean },
        source: { action: "create-user", method: "oauth" },
      },
      {
        setCookie,
      } as never,
    );
  return { run, setCookie };
}

describe("createUserValidator", () => {
  it("lets an allowlisted account through without a cookie", async () => {
    const { run, setCookie } = setup("ada@example.com");

    expect(await run("ada@example.com")).toBeUndefined();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("rejects anyone else with not_allowlisted", async () => {
    const { run } = setup("ada@example.com");

    expect(await run("mallory@example.com")).toMatchObject({ error: "not_allowlisted" });
  });

  it("remembers the rejected email in a short-lived, http-only cookie, not in the URL", async () => {
    const { run, setCookie } = setup("ada@example.com");

    const result = await run("Mallory@Example.com");

    expect(setCookie).toHaveBeenCalledWith(
      REJECTED_EMAIL_COOKIE,
      "mallory@example.com",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", maxAge: 300, path: "/" }),
    );
    expect(JSON.stringify(result)).not.toContain("mallory");
  });

  it.each([
    ["false", false],
    ["missing", undefined],
    ["not a boolean", "true"],
  ])("rejects an allowlisted email whose verification is %s", async (_name, emailVerified) => {
    const { run } = setup("ada@example.com");

    expect(await run("ada@example.com", emailVerified)).toMatchObject({ error: "not_allowlisted" });
  });

  it("rejects a profile without an email", async () => {
    const { run } = setup("ada@example.com");

    expect(await run(undefined)).toMatchObject({ error: "not_allowlisted" });
  });

  it("rejects everyone when the allowlist is empty", async () => {
    const { run } = setup("");

    expect(await run("ada@example.com")).toMatchObject({ error: "not_allowlisted" });
  });
});
