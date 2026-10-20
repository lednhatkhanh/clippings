import { randomUUID } from "node:crypto";

import { addHours, parseISO, subSeconds } from "date-fns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";

describe.skipIf(!TEST_DATABASE_URL)("connections service", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  const now = () => parseISO("2026-10-01T09:00:00.000Z");

  async function registerClient(clientId: string, name: string | null) {
    await fixture.pool.query(
      `insert into "oauthClient" (id, "clientId", name, "redirectUris") values ($1, $2, $3, '{}')`,
      [randomUUID(), clientId, name],
    );
    return clientId;
  }

  /** What Better Auth stores when the user allows a client and trades the code. */
  async function connect(
    userId: string,
    clientId: string,
    { at = now(), refreshExpiresAt = addHours(at, 24 * 30) } = {},
  ) {
    await fixture.pool.query(
      `insert into "oauthConsent" (id, "clientId", "userId", scopes, "createdAt", "updatedAt")
       values ($1, $2, $3, '{mcp}', $4, $4)`,
      [randomUUID(), clientId, userId, at],
    );
    const refreshId = randomUUID();
    await fixture.pool.query(
      `insert into "oauthRefreshToken" (id, token, "clientId", "userId", "expiresAt", "createdAt", scopes)
       values ($1, $2, $3, $4, $5, $6, '{mcp}')`,
      [refreshId, randomUUID(), clientId, userId, refreshExpiresAt, at],
    );
    await fixture.pool.query(
      `insert into "oauthAccessToken" (id, token, "clientId", "userId", "refreshId", "expiresAt", "createdAt", scopes)
       values ($1, $2, $3, $4, $5, $6, $7, '{mcp}')`,
      [randomUUID(), randomUUID(), clientId, userId, refreshId, addHours(at, 1), at],
    );
  }

  async function storedGrants(userId: string, clientId: string) {
    const { rows } = await fixture.pool.query<{ count: string }>(
      `select (select count(*) from "oauthConsent" where "userId" = $1 and "clientId" = $2)
            + (select count(*) from "oauthRefreshToken" where "userId" = $1 and "clientId" = $2)
            + (select count(*) from "oauthAccessToken" where "userId" = $1 and "clientId" = $2) as count`,
      [userId, clientId],
    );
    return Number(rows[0]!.count);
  }

  it("lists every client holding a grant for the user, with its name and last use", async () => {
    const ana = await fixture.createUser("ana");
    const claude = await registerClient("https://claude.ai/oauth/client.json", "Claude");
    const code = await registerClient("dyn-claude-code", "Claude Code");
    await connect(ana, claude, { at: subSeconds(now(), 3600) });
    await connect(ana, code, { at: subSeconds(now(), 60) });

    fixture.advanceClock(5000);
    expect(await fixture.connections.recordUse(ana, claude, subSeconds(now(), 10))).toBe(true);

    expect(await fixture.connections.listConnections(ana)).toEqual([
      {
        clientId: claude,
        name: "Claude",
        uri: null,
        connectedAt: subSeconds(now(), 3600),
        lastUsedAt: parseISO("2026-10-01T09:00:05.000Z"),
      },
      {
        clientId: code,
        name: "Claude Code",
        uri: null,
        connectedAt: subSeconds(now(), 60),
        lastUsedAt: subSeconds(now(), 60),
      },
    ]);
  });

  it("leaves out a client whose tokens all expired and that holds no consent", async () => {
    const ana = await fixture.createUser("ana");
    const old = await registerClient("old", "Old client");
    await connect(ana, old, {
      at: subSeconds(now(), 7200),
      refreshExpiresAt: subSeconds(now(), 1),
    });
    await fixture.pool.query(`delete from "oauthConsent"`);

    expect(await fixture.connections.listConnections(ana)).toEqual([]);
  });

  it("revokes one client: its grants go and its earlier tokens are refused", async () => {
    const ana = await fixture.createUser("ana");
    const claude = await registerClient("claude", "Claude");
    const code = await registerClient("code", "Claude Code");
    await connect(ana, claude);
    await connect(ana, code);
    const issuedAt = now();
    await fixture.connections.recordUse(ana, claude, issuedAt);

    fixture.advanceClock(1500);
    expect(await fixture.connections.revokeConnection(ana, claude)).toBe(true);

    expect(await storedGrants(ana, claude)).toBe(0);
    expect(await fixture.connections.recordUse(ana, claude, issuedAt)).toBe(false);
    // The other client keeps working.
    expect(await storedGrants(ana, code)).toBe(3);
    expect(await fixture.connections.recordUse(ana, code, issuedAt)).toBe(true);
    expect((await fixture.connections.listConnections(ana)).map((c) => c.clientId)).toEqual([code]);
  });

  it("refuses a token issued in the second the client was revoked, and takes a later one", async () => {
    const ana = await fixture.createUser("ana");
    const claude = await registerClient("claude", "Claude");
    await connect(ana, claude);
    fixture.advanceClock(400);
    await fixture.connections.revokeConnection(ana, claude);

    // `iat` is whole seconds: 09:00:00 is not after a revocation at 09:00:00.400.
    expect(await fixture.connections.recordUse(ana, claude, now())).toBe(false);
    // Connecting again issues tokens after the revocation.
    fixture.advanceClock(1000);
    expect(
      await fixture.connections.recordUse(ana, claude, parseISO("2026-10-01T09:00:01.000Z")),
    ).toBe(true);
  });

  it("revokes a client that was used but holds no stored grant", async () => {
    const ana = await fixture.createUser("ana");
    const claude = await registerClient("claude", "Claude");
    await fixture.connections.recordUse(ana, claude, now());

    fixture.advanceClock(1000);
    expect(await fixture.connections.revokeConnection(ana, claude)).toBe(true);
    expect(await fixture.connections.recordUse(ana, claude, now())).toBe(false);
  });

  it("keeps users apart: one user never sees or revokes another's connections", async () => {
    const ana = await fixture.createUser("ana");
    const bo = await fixture.createUser("bo");
    const claude = await registerClient("claude", "Claude");
    await connect(ana, claude);

    expect(await fixture.connections.listConnections(bo)).toEqual([]);
    expect(await fixture.connections.revokeConnection(bo, claude)).toBe(false);

    expect(await storedGrants(ana, claude)).toBe(3);
    expect(await fixture.connections.recordUse(ana, claude, now())).toBe(true);
    expect(await fixture.connections.listConnections(ana)).toHaveLength(1);
  });

  it("answers false for a client the user never connected", async () => {
    const ana = await fixture.createUser("ana");
    await registerClient("claude", "Claude");

    expect(await fixture.connections.revokeConnection(ana, "claude")).toBe(false);
    expect(await fixture.connections.revokeConnection(ana, "no-such-client")).toBe(false);
  });
});
