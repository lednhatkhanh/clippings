import { subDays } from "date-fns";
import { and, asc, desc, eq, gt, isNull, lt, max, notExists, or, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import type pg from "pg";

import type { Clock } from "../clippings/ports.ts";
import { createDatabase } from "../database.ts";
import {
  oauthAccessToken,
  oauthClient,
  oauthConnections,
  oauthConsent,
  oauthRefreshToken,
  verification,
} from "../schema.ts";

/**
 * How long a registered client may stay unused before the daily sweep removes it. Registration is
 * open (Claude Code registers itself), so abandoned and abusive registrations pile up otherwise.
 */
export const UNUSED_CLIENT_DAYS = 30;

export interface ConnectionsServiceDeps {
  pool: pg.Pool;
  clock: Clock;
}

/** An OAuth client connected to a user's account. */
export interface Connection {
  clientId: string;
  /** The name the client registered with, if any. */
  name: string | null;
  /** The client's home page, if it named one. */
  uri: string | null;
  /** When the user last allowed it, or it was last issued a token. */
  connectedAt: Date;
  /** When it last called `/mcp` or was issued a token; null if it never has. */
  lastUsedAt: Date | null;
}

/**
 * The OAuth clients that act for a user: Claude (claude.ai and Claude Code) and the extension.
 * Every operation takes the acting user and scopes its queries by them.
 */
export function createConnectionsService({ pool, clock }: ConnectionsServiceDeps) {
  const db = createDatabase(pool);

  /**
   * Every client that holds a grant for the user: a consent, or a refresh or opaque access token
   * that is neither revoked nor expired. Most recently used first.
   */
  async function listConnections(userId: string): Promise<Connection[]> {
    const now = clock.now();
    // `issued` is null for a consent: allowing a client is not using it.
    const grants = unionAll(
      db
        .select({
          clientId: oauthConsent.clientId,
          at: oauthConsent.updatedAt,
          issued: sql<Date | null>`null::timestamptz`.as("issued"),
        })
        .from(oauthConsent)
        .where(eq(oauthConsent.userId, userId)),
      db
        .select({
          clientId: oauthRefreshToken.clientId,
          at: oauthRefreshToken.createdAt,
          issued: sql<Date | null>`${oauthRefreshToken.createdAt}`.as("issued"),
        })
        .from(oauthRefreshToken)
        .where(
          and(
            eq(oauthRefreshToken.userId, userId),
            isNull(oauthRefreshToken.revoked),
            gt(oauthRefreshToken.expiresAt, now),
          ),
        ),
      db
        .select({
          clientId: oauthAccessToken.clientId,
          at: oauthAccessToken.createdAt,
          issued: sql<Date | null>`${oauthAccessToken.createdAt}`.as("issued"),
        })
        .from(oauthAccessToken)
        .where(
          and(
            eq(oauthAccessToken.userId, userId),
            isNull(oauthAccessToken.revoked),
            gt(oauthAccessToken.expiresAt, now),
          ),
        ),
    ).as("grants");

    const lastIssued = max(grants.issued);
    const lastUsedAt =
      sql<Date | null>`greatest(${oauthConnections.lastUsedAt}, ${lastIssued})`.mapWith(
        oauthConnections.lastUsedAt,
      );
    return db
      .select({
        clientId: oauthClient.clientId,
        name: oauthClient.name,
        uri: oauthClient.uri,
        connectedAt: sql<Date>`max(${grants.at})`.mapWith(oauthConsent.updatedAt),
        lastUsedAt,
      })
      .from(grants)
      .innerJoin(oauthClient, eq(oauthClient.clientId, grants.clientId))
      .leftJoin(
        oauthConnections,
        and(eq(oauthConnections.clientId, grants.clientId), eq(oauthConnections.userId, userId)),
      )
      .groupBy(oauthClient.clientId, oauthClient.name, oauthClient.uri, oauthConnections.lastUsedAt)
      .orderBy(
        sql`${lastUsedAt} desc nulls last`,
        desc(sql`max(${grants.at})`),
        asc(oauthClient.clientId),
      );
  }

  /**
   * Ends a client's access for the user at once: its consent, stored tokens and unexchanged
   * authorization codes go, and access tokens issued until now stop working (see `recordUse`).
   * Other clients are untouched. Returns false when the client held nothing for the user.
   *
   * A refresh racing the revocation can leave a new refresh token behind: Better Auth rotates in
   * two writes, and the transaction can commit between them. The window is milliseconds.
   */
  async function revokeConnection(userId: string, clientId: string): Promise<boolean> {
    const revokedAt = clock.now();
    return db.transaction(async (tx) => {
      const consents = await tx
        .delete(oauthConsent)
        .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
        .returning({ id: oauthConsent.id });
      // Deleting a refresh token also deletes the opaque access tokens issued with it.
      const refreshTokens = await tx
        .delete(oauthRefreshToken)
        .where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId)))
        .returning({ id: oauthRefreshToken.id });
      const accessTokens = await tx
        .delete(oauthAccessToken)
        .where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId)))
        .returning({ id: oauthAccessToken.id });
      // A code issued before now could still be traded for tokens. Better Auth keeps it as JSON
      // in `verification`, beside other flows' values; Postgres may evaluate conditions in any
      // order, so the cast sits behind a CASE that only reaches rows shaped like a code.
      const code = sql`case when ${verification.value} like '{"type":"authorization_code"%' then ${verification.value}::jsonb end`;
      const codes = await tx
        .delete(verification)
        .where(
          and(
            sql`${code} ->> 'userId' = ${userId}`,
            sql`${code} -> 'query' ->> 'client_id' = ${clientId}`,
          ),
        )
        .returning({ id: verification.id });

      const held = consents.length + refreshTokens.length + accessTokens.length + codes.length > 0;
      if (held) {
        // An upsert, so a first call landing mid-revocation can't fail it on the key.
        await tx
          .insert(oauthConnections)
          .values({ userId, clientId, revokedAt })
          .onConflictDoUpdate({
            target: [oauthConnections.userId, oauthConnections.clientId],
            set: { revokedAt, lastUsedAt: null },
          });
        return true;
      }
      const known = await tx
        .update(oauthConnections)
        .set({ revokedAt, lastUsedAt: null })
        .where(and(eq(oauthConnections.userId, userId), eq(oauthConnections.clientId, clientId)))
        .returning({ userId: oauthConnections.userId });
      return known.length > 0;
    });
  }

  /**
   * Records that the client called for the user with an access token issued at `issuedAt`.
   * Returns false, recording nothing, when the user revoked the client since: the token must be
   * refused. `issuedAt` is the token's `iat`, in whole seconds, so a token issued in the second
   * of a revocation is refused too. Also false when the client or user no longer exists: the
   * token outlived them.
   */
  async function recordUse(userId: string, clientId: string, issuedAt: Date): Promise<boolean> {
    const lastUsedAt = clock.now();
    try {
      const recorded = await db
        .insert(oauthConnections)
        .values({ userId, clientId, lastUsedAt })
        .onConflictDoUpdate({
          target: [oauthConnections.userId, oauthConnections.clientId],
          set: { lastUsedAt },
          setWhere: or(
            isNull(oauthConnections.revokedAt),
            lt(oauthConnections.revokedAt, issuedAt),
          ),
        })
        .returning({ userId: oauthConnections.userId });
      return recorded.length > 0;
    } catch (error) {
      if (isForeignKeyViolation(error)) return false;
      throw error;
    }
  }

  /**
   * For the daily cron: removes the clients registered more than `UNUSED_CLIENT_DAYS` ago that
   * no one ever allowed or still uses: no consent, refresh token, access token or unexchanged
   * authorization code. A client that connected keeps its row; one that is removed and returns
   * simply registers again. Returns how many it removed.
   */
  async function purgeUnusedClients(): Promise<number> {
    const registeredBefore = subDays(clock.now(), UNUSED_CLIENT_DAYS);
    // As in `revokeConnection`: the cast sits behind a CASE that only reaches rows shaped like a code.
    const code = sql`case when ${verification.value} like '{"type":"authorization_code"%' then ${verification.value}::jsonb end`;
    const removed = await db
      .delete(oauthClient)
      .where(
        and(
          lt(oauthClient.createdAt, registeredBefore),
          notExists(
            db
              .select({ one: sql`1` })
              .from(oauthConsent)
              .where(eq(oauthConsent.clientId, oauthClient.clientId)),
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(oauthRefreshToken)
              .where(eq(oauthRefreshToken.clientId, oauthClient.clientId)),
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(oauthAccessToken)
              .where(eq(oauthAccessToken.clientId, oauthClient.clientId)),
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(verification)
              .where(sql`${code} -> 'query' ->> 'client_id' = ${oauthClient.clientId}`),
          ),
        ),
      )
      .returning({ id: oauthClient.id });
    return removed.length;
  }

  return { listConnections, revokeConnection, recordUse, purgeUnusedClients };
}

/** Postgres' foreign_key_violation, as pg raises it or Drizzle wraps it. */
function isForeignKeyViolation(error: unknown): boolean {
  const code = (value: unknown) =>
    typeof value === "object" && value !== null && "code" in value ? value.code : undefined;
  return code(error) === "23503" || (error instanceof Error && code(error.cause) === "23503");
}

export type ConnectionsService = ReturnType<typeof createConnectionsService>;
