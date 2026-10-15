import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ClippingsStackIllustration, LetterboxIllustration } from "@clippings/ui";

import { AuthCard } from "../../components/auth-card";
import { getSession } from "../../lib/auth/session";
import { REJECTED_EMAIL_COOKIE, NOT_ALLOWLISTED } from "../../lib/auth/validate-user";
import { signInWithGoogle } from "./actions";

export const metadata: Metadata = { title: "Sign in · Clippings" };

const button =
  "state-layer inline-flex min-h-12 items-center justify-center rounded-full border border-outline px-6 typescale-label-lg text-primary";

function SignInCard({ failed = false }: { failed?: boolean }) {
  return (
    <AuthCard>
      <ClippingsStackIllustration className="h-40 w-60" />
      <h1 className="typescale-headline-sm">Your clippings, kept.</h1>
      {failed ? (
        <p role="alert" className="typescale-body-md text-error">
          Couldn&apos;t sign you in. Try again.
        </p>
      ) : null}
      <form action={signInWithGoogle}>
        <button type="submit" className={button}>
          Continue with Google
        </button>
      </form>
    </AuthCard>
  );
}

function PrivateCard({ email }: { email: string | undefined }) {
  return (
    <AuthCard>
      <LetterboxIllustration className="h-40 w-60" />
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
      <form action={signInWithGoogle}>
        <button type="submit" className={button}>
          Use another account
        </button>
      </form>
    </AuthCard>
  );
}

async function SignInContent({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  if (error === NOT_ALLOWLISTED) {
    return <PrivateCard email={(await cookies()).get(REJECTED_EMAIL_COOKIE)?.value} />;
  }
  if (await getSession()) redirect("/");

  return <SignInCard failed={Boolean(error)} />;
}

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense fallback={<SignInCard />}>
      <SignInContent searchParams={searchParams} />
    </Suspense>
  );
}
