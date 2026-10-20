import type { Metadata, Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AuthCard } from "@/components/auth-card.tsx";
import { RETURN_TO_PARAM, safeReturnPath } from "@/lib/auth/return-path.ts";
import { getSession } from "@/lib/auth/session.ts";
import { REJECTED_EMAIL_COOKIE, NOT_ALLOWLISTED } from "@/lib/auth/validate-user.ts";
import { ClippingsStackIllustration, LetterboxIllustration } from "@clippings/ui";

import { signInWithGoogle } from "./actions.ts";

export const metadata: Metadata = { title: "Sign in · Clippings" };

type SignInSearchParams = Promise<{ error?: string; [RETURN_TO_PARAM]?: string }>;

/** Posts to the sign-in action. Google shows its account chooser either way. */
function GoogleButton({ returnTo, children }: { returnTo: string | null; children: ReactNode }) {
  return (
    <form action={signInWithGoogle}>
      {returnTo ? <input type="hidden" name={RETURN_TO_PARAM} value={returnTo} /> : null}
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
}: {
  returnTo?: string | null;
  failed?: boolean;
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
      <GoogleButton returnTo={returnTo}>Continue with Google</GoogleButton>
    </AuthCard>
  );
}

function PrivateCard({ email, returnTo }: { email: string | undefined; returnTo: string | null }) {
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
      <GoogleButton returnTo={returnTo}>Use another account</GoogleButton>
    </AuthCard>
  );
}

async function SignInContent({ searchParams }: { searchParams: SignInSearchParams }) {
  const { error, [RETURN_TO_PARAM]: returnParam } = await searchParams;
  const returnTo = safeReturnPath(returnParam);

  if (error === NOT_ALLOWLISTED) {
    return (
      <PrivateCard
        email={(await cookies()).get(REJECTED_EMAIL_COOKIE)?.value}
        returnTo={returnTo}
      />
    );
  }
  // Checked by `safeReturnPath`: a path on this site, outside the typed routes.
  if (await getSession()) redirect((returnTo ?? "/") as Route);

  return <SignInCard returnTo={returnTo} failed={Boolean(error)} />;
}

export default function SignInPage({ searchParams }: { searchParams: SignInSearchParams }) {
  return (
    // The fallback form has no return path; the content replaces it once the request is read.
    <Suspense fallback={<SignInCard />}>
      <SignInContent searchParams={searchParams} />
    </Suspense>
  );
}
