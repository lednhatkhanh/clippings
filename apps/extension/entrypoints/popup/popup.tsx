import { constructNow } from "date-fns";
import { Suspense, use, useEffect, useRef, useState, type ReactNode } from "react";
import { browser, type Browser } from "wxt/browser";

import {
  NOTE_PORT,
  type NotePortMessage,
  type NotePortReply,
  type PopupRequest,
  type PopupResponses,
  type SignInProblem,
} from "@/lib/messages.ts";
import {
  formatAbsoluteDate,
  isSaveablePage,
  MAX_NOTE_LENGTH,
  type ExtensionSaveResponse,
} from "@clippings/shared";
import { Button, Icon, LinkButton, ProgressBar, TextField } from "@clippings/ui";

/** How long the note waits after the last keystroke before it saves. */
const NOTE_SAVE_DELAY_MS = 400;

type View =
  | { kind: "cant_save" }
  | { kind: "signed_out"; problem: SignInProblem | null }
  | { kind: "saved"; saved: ExtensionSaveResponse }
  | { kind: "error"; reason: "offline" | "failed" };

function ask<Request extends PopupRequest>(
  request: Request,
): Promise<PopupResponses[Request["type"]]> {
  return browser.runtime.sendMessage(request);
}

/**
 * What the popup shows on open. A page Clippings can't save says so before anything is sent;
 * otherwise the page is saved straight away, or found when it was saved before.
 */
async function open(): Promise<View> {
  // `activeTab`: the toolbar click that opened the popup grants this tab's address.
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url;
  if (!url || !isSaveablePage(url)) return { kind: "cant_save" };

  const status = await ask({ type: "status" });
  if (!status.signedIn) return { kind: "signed_out", problem: status.signInProblem };

  const result = await ask({ type: "save", url });
  if (result.ok) return { kind: "saved", saved: result.saved };
  switch (result.reason) {
    case "signed_out":
      return { kind: "signed_out", problem: null };
    case "not_allowlisted":
      return { kind: "signed_out", problem: "not_allowlisted" };
    case "invalid_url":
      return { kind: "cant_save" };
    case "offline":
    case "failed":
      return { kind: "error", reason: result.reason };
  }
}

/** Started as the popup loads, before React renders, and read with `use`. */
const opening = open();

const PROBLEMS: Record<SignInProblem, string> = {
  not_allowlisted: "That Google account isn't on this Clippings' list. Sign in with another one.",
  denied: "You chose not to connect the extension.",
  cancelled: "Sign-in didn't finish. Try again.",
  failed: "Couldn't sign in. Try again.",
};

function Panel({ children }: { children: ReactNode }) {
  return <main className="flex w-80 flex-col gap-4 p-4">{children}</main>;
}

function SignedOut({
  problem,
  onSignedIn,
}: {
  problem: SignInProblem | null;
  onSignedIn: () => void;
}) {
  const [waiting, setWaiting] = useState(false);

  async function signIn() {
    setWaiting(true);
    // The sign-in window takes focus, which closes the popup; the next one picks up from here.
    const { signedIn } = await ask({ type: "signIn" });
    setWaiting(false);
    if (signedIn) onSignedIn();
  }

  return (
    <Panel>
      <h1 className="typescale-title-md">Sign in to save pages</h1>
      {problem ? (
        <p role="alert" className="typescale-body-md text-error">
          {PROBLEMS[problem]}
        </p>
      ) : (
        <p className="typescale-body-md text-on-surface-variant">
          Use the Google account you use for Clippings.
        </p>
      )}
      <Button onPress={() => void signIn()} isPending={waiting}>
        Sign in
      </Button>
    </Panel>
  );
}

type NoteState = "idle" | "saving" | "saved" | "failed";

const NOTE_STATES: Record<NoteState, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Note saved",
  failed: "Couldn't save the note. It will save when you type again.",
};

/**
 * The clipping's note. It autosaves 400 ms after typing stops and on blur, through the service
 * worker, which also saves the last draft when the popup closes mid-edit.
 */
function NoteField({ clippingId, initialNote }: { clippingId: string; initialNote: string }) {
  const [note, setNote] = useState(initialNote);
  const [state, setState] = useState<NoteState>("idle");
  const port = useRef<Browser.runtime.Port | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const connection = browser.runtime.connect({ name: NOTE_PORT });
    connection.onMessage.addListener((reply: NotePortReply) => {
      setState(reply.type === "saved" ? "saved" : "failed");
    });
    port.current = connection;
    return () => {
      window.clearTimeout(timer.current);
      connection.disconnect();
    };
  }, []);

  const send = (message: NotePortMessage) => port.current?.postMessage(message);

  function save() {
    window.clearTimeout(timer.current);
    send({ type: "save" });
  }

  function change(value: string) {
    setNote(value);
    setState("saving");
    send({ type: "draft", clippingId, note: value });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, NOTE_SAVE_DELAY_MS);
  }

  return (
    <div className="flex flex-col gap-1">
      <TextField
        label="Note"
        placeholder="Why keep this?"
        multiline
        rows={4}
        maxLength={MAX_NOTE_LENGTH}
        value={note}
        onChange={change}
        onBlur={save}
      />
      <p aria-live="polite" className="min-h-5 typescale-body-sm text-on-surface-variant">
        {NOTE_STATES[state]}
      </p>
    </div>
  );
}

function Saved({ saved, onSignedOut }: { saved: ExtensionSaveResponse; onSignedOut: () => void }) {
  const { clipping } = saved;

  async function signOut() {
    await ask({ type: "signOut" });
    onSignedOut();
  }

  return (
    <Panel>
      <h1 aria-live="polite" className="flex items-center gap-2 typescale-title-md">
        {saved.status === "created" ? (
          <>
            <span className="inline-flex saved-pop text-primary">
              <Icon name="check" />
            </span>
            Saved
          </>
        ) : (
          <>Saved on {formatAbsoluteDate(clipping.createdAt, constructNow(undefined))}</>
        )}
      </h1>
      <p className="truncate typescale-body-sm text-on-surface-variant">{clipping.title}</p>
      <NoteField clippingId={clipping.id} initialNote={clipping.note} />
      <LinkButton variant="tonal" href={clipping.link} target="_blank" rel="noopener">
        Open in Clippings
        <Icon name="open_in_new" />
      </LinkButton>
      <Button variant="text" onPress={() => void signOut()} className="self-start">
        Sign out
      </Button>
    </Panel>
  );
}

function CurrentView({ view, reopen }: { view: Promise<View>; reopen: () => void }) {
  const current = use(view);
  switch (current.kind) {
    case "cant_save":
      return (
        <Panel>
          <p className="typescale-body-lg">Clippings can&apos;t save this page.</p>
        </Panel>
      );
    case "signed_out":
      return <SignedOut problem={current.problem} onSignedIn={reopen} />;
    case "saved":
      return <Saved saved={current.saved} onSignedOut={reopen} />;
    case "error":
      return (
        <Panel>
          <p role="alert" className="typescale-body-lg">
            {current.reason === "offline"
              ? "You're offline. Try again when you're back online."
              : "Couldn't save this page."}
          </p>
          <Button onPress={reopen}>Try again</Button>
        </Panel>
      );
  }
}

export function Popup() {
  const [view, setView] = useState(opening);
  return (
    <Suspense
      fallback={
        <Panel>
          <ProgressBar label="Saving" />
        </Panel>
      }
    >
      <CurrentView view={view} reopen={() => setView(open())} />
    </Suspense>
  );
}
