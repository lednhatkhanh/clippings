import { constructNow } from "date-fns";
import { Suspense, use, useEffect, useRef, useState, type ReactNode } from "react";
import { browser, type Browser } from "wxt/browser";

import {
  ask,
  NOTE_PORT,
  SIGN_IN_PROBLEMS,
  type NotePortMessage,
  type NotePortReply,
  type PopupResponses,
  type SignInProblem,
  type TagsReply,
} from "@/lib/messages.ts";
import { quoteSelection, readSelection } from "@/lib/quote.ts";
import {
  formatAbsoluteDate,
  isSaveablePage,
  MAX_NOTE_LENGTH,
  MAX_TAG_LENGTH,
  type ExtensionSaveResponse,
  type Tag,
} from "@clippings/shared";
import { Button, Icon, LinkButton, ProgressBar, TagPicker, TextField } from "@clippings/ui";

/** How long the note waits after the last keystroke before it saves. */
const NOTE_SAVE_DELAY_MS = 400;

type View =
  | { kind: "cant_save" }
  | { kind: "signed_out"; problem: SignInProblem | null }
  | { kind: "saved"; saved: ExtensionSaveResponse; quote: string }
  | { kind: "error"; reason: "offline" | "failed" };

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

  // The palette may have changed in Clippings since the last open: the page follows the stored
  // one, so a newer palette crossfades in.
  void ask({ type: "refreshPalette" });
  // What's selected on the page, read alongside the save: it becomes the note of a new clipping.
  const [result, selection] = await Promise.all([
    ask({ type: "save", url }),
    tab.id === undefined ? "" : readSelection(tab.id),
  ]);
  if (result.ok) {
    const fresh = result.saved.status === "created" && !result.saved.clipping.note;
    return { kind: "saved", saved: result.saved, quote: fresh ? quoteSelection(selection) : "" };
  }
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
          {SIGN_IN_PROBLEMS[problem]}
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

type NoteState = "idle" | "saving" | NotePortReply["type"];

const NOTE_STATES: Record<NoteState, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Note saved",
  gone: "This clipping was deleted in Clippings, so the note wasn't saved.",
  failed: "Couldn't save the note. It will save when you type again.",
};

/**
 * The clipping's note. It autosaves 400 ms after typing stops and on blur, through the service
 * worker, which also saves the last draft when the popup closes mid-edit. A `quote` of the
 * page's selection starts a new clipping's note, and is saved straight away.
 */
function NoteField({
  clippingId,
  initialNote,
  quote,
}: {
  clippingId: string;
  initialNote: string;
  quote: string;
}) {
  const [note, setNote] = useState(quote || initialNote);
  const [state, setState] = useState<NoteState>(quote ? "saving" : "idle");
  const port = useRef<Browser.runtime.Port | null>(null);
  const timer = useRef<number | undefined>(undefined);
  /** The text as last typed, to tell a save of older text from one of what's in the field. */
  const latest = useRef(quote || initialNote);

  useEffect(() => {
    const connection = browser.runtime.connect({ name: NOTE_PORT });
    connection.onMessage.addListener((reply: NotePortReply) => {
      // A save of older text while newer text waits: still saving.
      if (reply.type === "saved" && reply.note !== latest.current) return;
      setState(reply.type);
    });
    port.current = connection;
    if (quote) {
      const draft: NotePortMessage = { type: "draft", clippingId, note: quote };
      connection.postMessage(draft);
      connection.postMessage({ type: "save" } satisfies NotePortMessage);
    }
    return () => {
      window.clearTimeout(timer.current);
      connection.disconnect();
    };
  }, [clippingId, quote]);

  const send = (message: NotePortMessage) => port.current?.postMessage(message);

  function save() {
    window.clearTimeout(timer.current);
    send({ type: "save" });
  }

  function change(value: string) {
    latest.current = value;
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

type TagState = "idle" | "saving" | "saved" | "gone" | "failed";

const TAG_STATES: Record<TagState, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Tags saved",
  gone: "This clipping was deleted in Clippings, so the tags weren't saved.",
  failed: "Couldn't save your tags. Change them to try again.",
};

/**
 * The clipping's tags, as in the web app: each change saves at once through the service worker,
 * which saves them one at a time, and a name the user has no tag for creates one.
 */
function TagField({ clippingId, initialTags }: { clippingId: string; initialTags: Tag[] }) {
  const [value, setValue] = useState(() => initialTags.map((tag) => tag.name));
  const [state, setState] = useState<TagState>("idle");
  /** The user's tags, once they load; the clipping's own show before that. */
  const [tags, setTags] = useState<Tag[]>([]);
  /** Tags this popup has saved, so a new one keeps its color until the list is read again. */
  const [stored, setStored] = useState(initialTags);
  /** The names last chosen: only the save of those may set the status. */
  const latest = useRef(value);

  const reload = () => {
    // No answer is the service worker failing: nothing to offer yet.
    void ask({ type: "tags" }).then((answer: PopupResponses["tags"] | undefined) => {
      if (answer?.tags) setTags(answer.tags);
    });
  };
  useEffect(reload, []);

  const offered = [...tags, ...stored.filter((tag) => !tags.some(({ id }) => id === tag.id))];

  async function change(names: string[]) {
    setValue(names);
    latest.current = names;
    setState("saving");
    const reply: TagsReply | undefined = await ask({ type: "setTags", clippingId, tags: names });
    if (reply?.type === "saved") {
      setStored(reply.tags);
      reload();
    }
    if (latest.current === names) setState(reply?.type ?? "failed");
  }

  return (
    <div className="flex flex-col gap-1">
      <TagPicker
        label="Tags"
        tags={offered}
        value={value}
        onChange={(names) => void change(names)}
        maxLength={MAX_TAG_LENGTH}
      />
      {/* An <output> is a polite live region, so the status is announced without moving focus. */}
      <output aria-live="polite" className="min-h-5 typescale-body-sm text-on-surface-variant">
        {TAG_STATES[state]}
      </output>
    </div>
  );
}

function Saved({
  saved,
  quote,
  onSignedOut,
}: {
  saved: ExtensionSaveResponse;
  quote: string;
  onSignedOut: () => void;
}) {
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
      <NoteField clippingId={clipping.id} initialNote={clipping.note} quote={quote} />
      <TagField clippingId={clipping.id} initialTags={clipping.tags} />
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
      return <Saved saved={current.saved} quote={current.quote} onSignedOut={reopen} />;
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
