import { createHmac, randomUUID } from "node:crypto";

/** What a `pg.Pool` or `pg.Client` offers: all the session helper needs. */
interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}

export interface TestUser {
  id: string;
  name: string;
  email: string;
}

export interface TestSession {
  userId: string;
  /**
   * The value of Better Auth's session cookie (URL-encoded, as the browser sends it): the token
   * and its HMAC signature under the app's secret.
   */
  cookieValue: string;
}

/** Better Auth's session cookie, which carries the `__Secure-` prefix in a production build. */
export function sessionCookieName({ secure }: { secure: boolean }): string {
  return `${secure ? "__Secure-" : ""}better-auth.session_token`;
}

/**
 * Signs a user in without Google, for tests and local trials: inserts the user (if new) and a
 * session in Better Auth's tables, and returns the cookie the app accepts for it. The same
 * `secret` as the app's `BETTER_AUTH_SECRET` signs the token. Never for a real database.
 *
 * Runs again with the same ids to refresh the session's expiry (the local sign-in script does).
 */
export async function createTestSession({
  db,
  secret,
  user,
  sessionId = `session-${randomUUID()}`,
  token = randomUUID().replaceAll("-", ""),
}: {
  db: Queryable;
  secret: string;
  user: TestUser;
  sessionId?: string;
  token?: string;
}): Promise<TestSession> {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified") values ($1, $2, $3, true)
     on conflict do nothing`,
    [user.id, user.name, user.email],
  );
  await db.query(
    `insert into session (id, "expiresAt", token, "updatedAt", "userId")
     values ($1, now() + interval '7 days', $2, now(), $3)
     on conflict (id) do update set "expiresAt" = excluded."expiresAt"`,
    [sessionId, token, user.id],
  );
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return { userId: user.id, cookieValue: encodeURIComponent(`${token}.${signature}`) };
}
