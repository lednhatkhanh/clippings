import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AuthCard } from "@/components/auth-card.tsx";
import { getSession } from "@/lib/auth/session.ts";
import { REJECTED_EMAIL_COOKIE, NOT_ALLOWLISTED } from "@/lib/auth/validate-user.ts";
import { ClippingsStackIllustration, LetterboxIllustration } from "@clippings/ui";

import { signInWithGoogle } from "./actions.ts";

export const metadata: Metadata = { title: "Sign in · Clippings" };

/** Posts to the sign-in action. Google shows its account chooser either way. */
function GoogleButton({ children }: { children: ReactNode }) {
  return (
    <form action={signInWithGoogle}>
      <button
        type="submit"
        className="state-layer inline-flex min-h-12 items-center justify-center rounded-full border border-outline px-6 typescale-label-lg text-primary"
      >
        {children}
      </button>
    </form>
  );
}

function SignInCard({ failed = false }: { failed?: boolean }) {
  return (
    <AuthCard>
      <ClippingsStackIllustration className="h-auto w-60" />
      <h1 className="typescale-headline-sm">Your clippings, kept.</h1>
      {failed ? (
        <p role="alert" className="typescale-body-md text-error">
          Couldn&apos;t sign you in. Try again.
        </p>
      ) : null}
      <GoogleButton>Continue with Google</GoogleButton>
    </AuthCard>
  );
}

function PrivateCard({ email }: { email: string | undefined }) {
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
      <GoogleButton>Use another account</GoogleButton>
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
