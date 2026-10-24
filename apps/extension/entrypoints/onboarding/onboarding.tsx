import { Check } from "lucide-react";
import { Suspense, use, useState, type ReactNode } from "react";
import { browser, type Browser } from "wxt/browser";

import { ask, SIGN_IN_PROBLEMS, type SignInProblem } from "@/lib/messages.ts";
import { Button, ClippingsStackIllustration } from "@clippings/ui";

/** Where Chrome lets the user choose the extension's keyboard shortcuts. */
const SHORTCUTS_PAGE = "chrome://extensions/shortcuts";

/** The command the toolbar button runs: opening the popup, which saves the page. */
const OPEN_POPUP = "_execute_action";

/** The extension's commands that have a shortcut, the popup's first. */
async function shortcuts(): Promise<Browser.commands.Command[]> {
  const commands = await browser.commands.getAll();
  return commands
    .filter((command) => command.shortcut)
    .sort((a, b) => Number(b.name === OPEN_POPUP) - Number(a.name === OPEN_POPUP));
}

const loadingShortcuts = shortcuts().catch(() => []);
const loadingStatus = ask({ type: "status" });

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4 rounded-lg paper p-5">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft typescale-label-lg text-on-accent-soft"
      >
        {number}
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="typescale-title-lg">{title}</h2>
        {children}
      </div>
    </li>
  );
}

function Shortcuts() {
  const commands = use(loadingShortcuts);
  if (commands.length === 0) {
    return (
      <>
        <p className="typescale-body-md text-ink-muted">
          Choose a keyboard shortcut to save the page you&apos;re on without reaching for the mouse.
        </p>
        <Button
          variant="outlined"
          className="self-start"
          onPress={() => void browser.tabs.create({ url: SHORTCUTS_PAGE })}
        >
          Choose a shortcut
        </Button>
      </>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {commands.map((command) => (
        <li key={command.name} className="flex items-center gap-3 typescale-body-md">
          <kbd className="rounded-sm bg-ground-sunk px-2 py-0.5 typescale-label-lg font-mono">
            {command.shortcut}
          </kbd>
          <span className="text-ink-muted">
            {command.name === OPEN_POPUP
              ? "saves the page you're on"
              : (command.description ?? command.name)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SignIn() {
  // No answer from the service worker: show the sign-in as it stands, with a problem to retry.
  const initial = use(loadingStatus);
  const [signedIn, setSignedIn] = useState(initial?.signedIn ?? false);
  const [problem, setProblem] = useState<SignInProblem | null>(
    initial ? initial.signInProblem : "failed",
  );
  const [waiting, setWaiting] = useState(false);

  async function signIn() {
    setWaiting(true);
    setProblem(null);
    const result = await ask({ type: "signIn" });
    setWaiting(false);
    setSignedIn(result?.signedIn ?? false);
    if (!result?.signedIn) setProblem((await ask({ type: "status" }))?.signInProblem ?? "failed");
  }

  if (signedIn) {
    return (
      <output className="flex items-center gap-2 typescale-body-md">
        <span className="inline-flex text-accent-ink">
          <Check className="size-5" />
        </span>
        You&apos;re signed in. Pages you save show up in Clippings.
      </output>
    );
  }
  return (
    <>
      {problem ? (
        <p role="alert" className="typescale-body-md text-danger">
          {SIGN_IN_PROBLEMS[problem]}
        </p>
      ) : (
        <p className="typescale-body-md text-ink-muted">
          Use the Google account you use for Clippings.
        </p>
      )}
      <Button className="self-start" onPress={() => void signIn()} isPending={waiting}>
        Sign in
      </Button>
    </>
  );
}

export function Onboarding() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col items-start gap-4">
        <ClippingsStackIllustration />
        <h1 className="typescale-headline-md">Clippings is ready</h1>
        <p className="typescale-body-lg text-ink-muted">
          Save the page you&apos;re on, with a note and tags, in one click. Three things to get
          going:
        </p>
      </header>
      <ol className="flex flex-col gap-4">
        <Step number={1} title="Pin it to the toolbar">
          <p className="typescale-body-md text-ink-muted">
            Click the puzzle-piece Extensions button at the right of Chrome&apos;s toolbar, then the
            pin next to Clippings. Its button stays in the toolbar, one click from any page.
          </p>
        </Step>
        <Step number={2} title="Save with a shortcut">
          <Suspense fallback={null}>
            <Shortcuts />
          </Suspense>
        </Step>
        <Step number={3} title="Sign in">
          <Suspense fallback={null}>
            <SignIn />
          </Suspense>
        </Step>
      </ol>
    </main>
  );
}
