import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth-card.tsx";
import { isAllowlisted, parseAllowlist } from "@/lib/auth/allowlist.ts";
import { getAuth } from "@/lib/auth/auth.ts";
import { closedPage } from "@/lib/auth/connection.ts";
import { signedOAuthQuery } from "@/lib/auth/oauth-query.ts";
import { getSession } from "@/lib/auth/session.ts";
import { isExtensionRedirectUri, parseExtensionIds } from "@/lib/extension/origins.ts";
import { readOnlyScopes, WRITE_SCOPE } from "@/lib/mcp/scopes.ts";
import { Button, ClippingsStackIllustration } from "@clippings/ui";

import {
  allowConnectionAction,
  allowReadOnlyConnectionAction,
  denyConnectionAction,
  switchAccountAction,
} from "./actions.ts";

export const metadata: Metadata = { title: "Connect · Clippings", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The client's own name, from its metadata, or the host its id points at. */
async function clientName(clientId: string): Promise<string> {
  try {
    const client = await getAuth().api.getOAuthClientPublic({
      query: { client_id: clientId },
      headers: await headers(),
    });
    if (client?.client_name) return client.client_name;
  } catch (error) {
    console.error("Couldn't read the OAuth client", error);
  }
  return URL.canParse(clientId) ? new URL(clientId).host : "An app";
}

/**
 * Where Allow sends the authorization, in words: the client's own name can say anything, but
 * this is where its access ends up. The provider only allows claude.ai, loopback ports and the
 * trusted extensions.
 */
function returnsTo(redirectUri: string): string {
  if (!URL.canParse(redirectUri)) return "the app";
  if (isExtensionRedirectUri(redirectUri, parseExtensionIds(process.env.EXTENSION_IDS))) {
    return "the Clippings extension";
  }
  const { protocol, hostname } = new URL(redirectUri);
  return protocol === "http:" ? "an app on this computer" : hostname;
}

async function ConsentContent({ searchParams }: { searchParams: SearchParams }) {
  const oauthQuery = signedOAuthQuery(await searchParams);
  const { secret } = await getAuth().$context;
  if (!oauthQuery || !(await verifyOAuthQueryParams(oauthQuery, secret))) {
    redirect(closedPage("expired"));
  }

  const session = await getSession();
  if (!session) redirect(closedPage("failed"));
  if (!isAllowlisted(parseAllowlist(process.env.ALLOWED_EMAILS), session.user.email)) {
    redirect(closedPage("private"));
  }

  const request = new URLSearchParams(oauthQuery);
  const name = await clientName(request.get("client_id") ?? "");
  const destination = returnsTo(request.get("redirect_uri") ?? "");
  const canWrite = request.get("scope")?.split(" ").includes(WRITE_SCOPE) ?? false;
  const canReadOnly = canWrite && readOnlyScopes(request.get("scope")).length > 0;

  return (
    <>
      <h1 className="typescale-headline-sm">
        <span className="break-words">{name}</span> wants to{" "}
        {canWrite ? "save, search, change and delete" : "save and search"} your clippings
      </h1>
      {canWrite ? (
        <p className="typescale-body-md text-ink-muted">
          It will be able to rename clippings, edit their notes and tags, and delete them. A deleted
          clipping can be restored for 24 hours. Allow read-only lets it save and search only.
        </p>
      ) : null}
      <p className="typescale-body-md text-ink-muted">
        Allowing sends you back to <span className="text-ink">{destination}</span>.
      </p>
      <div className="typescale-body-md text-ink-muted">
        Signed in as <span className="break-all text-ink">{session.user.email}</span>.{" "}
        <form action={switchAccountAction} className="inline">
          <input type="hidden" name="oauth_query" value={oauthQuery} />
          <button type="submit" className="text-accent-ink underline">
            Not you?
          </button>
        </form>
      </div>
      <div className="flex w-full flex-col gap-3">
        <form action={allowConnectionAction}>
          <input type="hidden" name="oauth_query" value={oauthQuery} />
          <Button type="submit" className="w-full">
            Allow
          </Button>
        </form>
        {canReadOnly ? (
          <form action={allowReadOnlyConnectionAction}>
            <input type="hidden" name="oauth_query" value={oauthQuery} />
            <Button type="submit" variant="paper" className="w-full">
              Allow read-only
            </Button>
          </form>
        ) : null}
        <form action={denyConnectionAction}>
          <input type="hidden" name="oauth_query" value={oauthQuery} />
          <Button type="submit" variant="paper" className="w-full">
            Deny
          </Button>
        </form>
      </div>
    </>
  );
}

/**
 * The OAuth consent page: Claude (or another client) asks to act for the signed-in user. The
 * provider sends the user here with the authorization request signed in the query.
 */
export default function ConnectPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthCard>
      <ClippingsStackIllustration className="h-auto w-50" />
      <Suspense fallback={<p className="typescale-body-md text-ink-muted">Loading…</p>}>
        <ConsentContent searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}
