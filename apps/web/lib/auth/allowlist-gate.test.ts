import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serveAuth, signIn } from "@/lib/auth/testing.ts";
import { createPool } from "@clippings/db";
import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";

const ORIGIN = "http://localhost:3999";

describe.skipIf(!TEST_DATABASE_URL)("the allowlist on sessions", () => {
  let fixture: ServiceFixture;
  let pool: ReturnType<typeof createPool>;

  beforeEach(async () => {
    fixture = await createServiceFixture();
    pool = createPool(fixture.databaseUrl);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await pool.end();
    await fixture.close();
  });

  const sessionCount = async () =>
    Number((await pool.query(`select count(*) from "session"`)).rows[0].count);

  it("keeps a session for an allowlisted account", async () => {
    const { auth, call } = serveAuth({ pool, origin: ORIGIN, allowedEmails: "ada@example.com" });
    const cookie = await signIn(pool, "ada", "ada@example.com");

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe("ada@example.com");
    expect((await call("/api/auth/list-sessions", { headers: { cookie } })).status).toBe(200);
  });

  it("gives no session to an account removed from the allowlist, and ends its sessions", async () => {
    const { auth } = serveAuth({ pool, origin: ORIGIN, allowedEmails: "grace@example.com" });
    const cookie = await signIn(pool, "ada", "ada@example.com");
    expect(await sessionCount()).toBe(1);

    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect(await sessionCount()).toBe(0);
  });

  it("ignores the cached session cookie of an account removed from the allowlist, and clears the cookies", async () => {
    const before = serveAuth({ pool, origin: ORIGIN, allowedEmails: "ada@example.com" });
    const cookie = await signIn(pool, "ada", "ada@example.com");
    // Reading the session while allowlisted hands out the signed copy of it (`session_data`).
    const first = await before.call("/api/auth/get-session", { headers: { cookie } });
    const cached = first.headers
      .getSetCookie()
      .map((header) => header.split(";")[0]!)
      .find((pair) => pair.startsWith("better-auth.session_data="));
    expect(cached).toBeDefined();

    // The email leaves the list; the same secret still verifies the cookie.
    const after = serveAuth({ pool, origin: ORIGIN, allowedEmails: "grace@example.com" });
    const response = await after.call("/api/auth/get-session", {
      headers: { cookie: `${cookie}; ${cached}` },
    });

    expect(await response.json()).toBeNull();
    const cleared = response.headers.getSetCookie().join("\n");
    expect(cleared).toMatch(/better-auth\.session_data=;/);
    expect(cleared).toMatch(/better-auth\.session_token=;/);
    expect(cleared).toContain("clippings-rejected-email=ada%40example.com");
    expect(await sessionCount()).toBe(0);
  });

  it("refuses the rest of Better Auth's endpoints to an account off the list", async () => {
    const { call } = serveAuth({ pool, origin: ORIGIN, allowedEmails: "grace@example.com" });
    const cookie = await signIn(pool, "ada", "ada@example.com");

    const response = await call("/api/auth/list-sessions", { headers: { cookie } });

    expect(response.status).toBe(403);
    expect(await sessionCount()).toBe(0);
  });

  it("lets an account off the list sign out", async () => {
    const { call } = serveAuth({ pool, origin: ORIGIN, allowedEmails: "grace@example.com" });
    const cookie = await signIn(pool, "ada", "ada@example.com");

    const response = await call("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(200);
  });
});
