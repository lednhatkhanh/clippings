import { randomUUID } from "node:crypto";

import { expect, test as base, type BrowserContext } from "@playwright/test";
import pg from "pg";

import {
  createClippingsService,
  createPool,
  systemClock,
  type ClippingsService,
} from "@clippings/db";
import { createTestSession, sessionCookieName } from "@clippings/db/testing";

import { AUTH_SECRET, BASE_URL, E2E_DATABASE_URL } from "./env.ts";

/** A user the suite created, and the session cookie that signs them in. */
export interface E2EUser {
  id: string;
  email: string;
  cookieValue: string;
}

interface TestFixtures {
  /** Whether the test's browser context starts signed in as `user`. Anonymous specs turn it off. */
  signedIn: boolean;
  /**
   * A fresh `e2e-<random>` user for this test, signed in on its browser context unless the test
   * is `signedIn: false`. Set up for every test, so a test needs it only to know who it is.
   */
  user: E2EUser;
  /** Creates another fresh user, not signed in anywhere: for specs about two people. */
  createUser: () => Promise<E2EUser>;
}

interface WorkerFixtures {
  database: pg.Pool;
  /**
   * The Clippings service on the end-to-end database, to seed what a spec needs. Its ports do
   * nothing: a seeded clipping stays pending, and nothing is fetched, summarized or embedded.
   */
  clippings: ClippingsService;
}

/**
 * Signs a browser context in as `user`. A production build's cookie is `__Secure-` prefixed,
 * which Chromium accepts on `http://localhost`.
 */
export async function signIn(context: BrowserContext, user: E2EUser) {
  await context.addCookies([
    {
      name: sessionCookieName({ secure: true }),
      value: user.cookieValue,
      domain: new URL(BASE_URL).hostname,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

const unavailable = (what: string) => () => Promise.reject(new Error(`${what} is not for seeding`));

export const test = base.extend<TestFixtures, WorkerFixtures>({
  database: [
    async ({}, use) => {
      const pool = createPool(E2E_DATABASE_URL);
      await use(pool);
      await pool.end();
    },
    { scope: "worker" },
  ],

  clippings: [
    async ({ database }, use) => {
      await use(
        createClippingsService({
          pool: database,
          jobs: { requestEnrichment: async () => {}, requestEnrichments: async () => {} },
          clock: systemClock,
          fetcher: { fetchPage: unavailable("Fetching a page") },
          summarizer: { summarize: unavailable("Summarizing") },
          embedder: { embed: unavailable("Embedding") },
        }),
      );
    },
    { scope: "worker" },
  ],

  createUser: async ({ database }, use) => {
    await use(async () => {
      const slug = randomUUID().slice(0, 8);
      const id = `e2e-${slug}`;
      const email = `${id}@example.com`;
      const { cookieValue } = await createTestSession({
        db: database,
        secret: AUTH_SECRET,
        user: { id, name: id, email },
      });
      return { id, email, cookieValue };
    });
  },

  signedIn: [true, { option: true }],

  user: [
    async ({ createUser, context, signedIn }, use) => {
      const user = await createUser();
      if (signedIn) await signIn(context, user);
      await use(user);
    },
    { auto: true },
  ],
});

export { expect };
