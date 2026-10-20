import { and, asc, desc, eq, gt, isNull, lt, max, or, sql } from "drizzle-orm";
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
} from "../schema.ts";

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
   * Ends a client's access for the user at once: its consent and stored tokens go, and access
   * tokens issued until now stop working (see `recordUse`). Other clients are untouched. Returns
   * false when the client held nothing for the user.
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
      const known = await tx
        .update(oauthConnections)
        .set({ revokedAt, lastUsedAt: null })
        .where(and(eq(oauthConnections.userId, userId), eq(oauthConnections.clientId, clientId)))
        .returning({ userId: oauthConnections.userId });

      const held = consents.length + refreshTokens.length + accessTokens.length > 0;
      if (held && known.length === 0) {
        await tx.insert(oauthConnections).values({ userId, clientId, revokedAt });
      }
      return held || known.length > 0;
    });
  }

  /**
   * Records that the client called for the user with an access token issued at `issuedAt`.
   * Returns false, recording nothing, when the user revoked the client since: the token must be
   * refused. `issuedAt` is the token's `iat`, in whole seconds, so a token issued in the second
   * of a revocation is refused too.
   */
  async function recordUse(userId: string, clientId: string, issuedAt: Date): Promise<boolean> {
    const lastUsedAt = clock.now();
    const recorded = await db
      .insert(oauthConnections)
      .values({ userId, clientId, lastUsedAt })
      .onConflictDoUpdate({
        target: [oauthConnections.userId, oauthConnections.clientId],
        set: { lastUsedAt },
        setWhere: or(isNull(oauthConnections.revokedAt), lt(oauthConnections.revokedAt, issuedAt)),
      })
      .returning({ userId: oauthConnections.userId });
    return recorded.length > 0;
  }

  return { listConnections, revokeConnection, recordUse };
}

export type ConnectionsService = ReturnType<typeof createConnectionsService>;
