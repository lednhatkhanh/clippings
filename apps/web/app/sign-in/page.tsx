import type { Metadata, Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AuthCard } from "@/components/auth-card.tsx";
import { AUTHORIZATION_ERRORS, closedPage } from "@/lib/auth/connection.ts";
import { signedOAuthQuery } from "@/lib/auth/oauth-query.ts";
import { RETURN_TO_PARAM, safeReturnPath } from "@/lib/auth/return-path.ts";
import { getSession } from "@/lib/auth/session.ts";
import { REJECTED_EMAIL_COOKIE, NOT_ALLOWLISTED } from "@/lib/auth/validate-user.ts";
import { ClippingsStackIllustration, LetterboxIllustration } from "@clippings/ui";

import { signInWithGoogle } from "./actions.ts";

export const metadata: Metadata = { title: "Sign in · Clippings" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Posts to the sign-in action. Google shows its account chooser either way. `oauthQuery` is the
 * signed authorization request when Claude is connecting, so sign-in resumes it.
 */
function GoogleButton({
  returnTo,
  oauthQuery,
  children,
}: {
  returnTo: string | null;
  oauthQuery?: string;
  children: ReactNode;
}) {
  return (
    <form action={signInWithGoogle}>
      {returnTo ? <input type="hidden" name={RETURN_TO_PARAM} value={returnTo} /> : null}
      {oauthQuery ? <input type="hidden" name="oauth_query" value={oauthQuery} /> : null}
      <button
        type="submit"
        className="state-layer inline-flex min-h-12 items-center justify-center rounded-full border border-outline px-6 typescale-label-lg text-primary"
      >
        {children}
      </button>
    </form>
  );
}

function SignInCard({
  returnTo = null,
  failed = false,
  oauthQuery,
}: {
  returnTo?: string | null;
  failed?: boolean;
  oauthQuery?: string;
}) {
  return (
    <AuthCard>
      <ClippingsStackIllustration className="h-auto w-60" />
      <h1 className="typescale-headline-sm">Your clippings, kept.</h1>
      {failed ? (
        <p role="alert" className="typescale-body-md text-error">
          Couldn&apos;t sign you in. Try again.
        </p>
      ) : null}
      <GoogleButton returnTo={returnTo} oauthQuery={oauthQuery}>
        Continue with Google
      </GoogleButton>
    </AuthCard>
  );
}

function PrivateCard({
  email,
  returnTo,
  oauthQuery,
}: {
  email: string | undefined;
  returnTo: string | null;
  oauthQuery?: string;
}) {
  return (
    <AuthCard>
      <LetterboxIllustration className="h-auto w-50" />
      <h1 className="typescale-headline-sm">This Clippings is private</h1>
      <p className="typescale-body-md text-on-surface-variant">
        {email ? (
          <>
            <span className="font-mono text-on-surface">{email}</span> isn&apos;t on the list.
          </>
        ) : (
          "That account isn't on the list."
        )}
      </p>
      <GoogleButton returnTo={returnTo} oauthQuery={oauthQuery}>
        Use another account
      </GoogleButton>
    </AuthCard>
  );
}

async function SignInContent({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const returnTo = safeReturnPath(params[RETURN_TO_PARAM]);
  const oauthQuery = signedOAuthQuery(params);

  // The OAuth provider couldn't trust the client or its redirect URI enough to tell it.
  if (error && AUTHORIZATION_ERRORS.has(error)) redirect(closedPage("failed"));

  if (error === NOT_ALLOWLISTED) {
    return (
      <PrivateCard
        email={(await cookies()).get(REJECTED_EMAIL_COOKIE)?.value}
        returnTo={returnTo}
        oauthQuery={oauthQuery}
      />
    );
  }
  // Checked by `safeReturnPath`: a path on this site, outside the typed routes. A connecting
  // client can ask for a fresh sign-in (`prompt=login`), so a session doesn't skip the card then.
  if (!oauthQuery && (await getSession())) redirect((returnTo ?? "/") as Route);

  return <SignInCard returnTo={returnTo} failed={Boolean(error)} oauthQuery={oauthQuery} />;
}

export default function SignInPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    // The fallback form has no return path; the content replaces it once the request is read.
    <Suspense fallback={<SignInCard />}>
      <SignInContent searchParams={searchParams} />
    </Suspense>
  );
}
