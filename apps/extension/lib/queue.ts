import { browser } from "wxt/browser";

import { parseWebUrl, type ExtensionPage } from "@clippings/shared";

/**
 * A save the user made while offline: the page, the selection to add to its note, if any, and
 * the page's text as the browser showed it then, which the retry sends (saves queued before
 * this existed have none).
 */
export interface PendingSave {
  url: string;
  quote?: string;
  page?: ExtensionPage;
}

/** The tab a save was made in and the page it showed, so the tab can show it sent. */
export interface SavedFrom {
  tabId?: number;
  pageUrl?: string;
}

export interface QueuedSave extends PendingSave, SavedFrom {
  id: string;
  /** Tries the server answered with a failure. Being offline or signed out doesn't count. */
  failures: number;
}

/**
 * How one try went. `sent` and `drop` take the save off the queue (`drop` for one the server will
 * never take, such as an address it refuses). `later` (offline, signed out) and `failed` (the
 * server's error) keep it and stop the run, so saves go out in the order they were made.
 */
export type SendOutcome = "sent" | "drop" | "later" | "failed";

/** After this many failed tries, a save is given up on. */
export const MAX_FAILURES = 10;

/**
 * Retries the queue while it holds saves. A service worker gets no `online` event, and may be
 * asleep when the network comes back: the alarm wakes it, every 30 seconds (Chrome's shortest).
 */
export const RETRY_ALARM = "retry-offline-saves";

const STORAGE_KEY = "offlineSaves";

/**
 * Two saves are the same when they are of the same page, as the server tells pages apart, with
 * the same selection (the page's text, which only goes along, doesn't tell saves apart). The
 * server finds an already-saved page instead of saving it again, so a
 * save that went out but whose answer was lost does no harm either.
 */
const sameSave = (a: PendingSave, b: PendingSave) =>
  (parseWebUrl(a.url)?.normalized ?? a.url) === (parseWebUrl(b.url)?.normalized ?? b.url) &&
  (a.quote ?? "") === (b.quote ?? "");

async function read(): Promise<QueuedSave[]> {
  const stored = (await browser.storage.local.get(STORAGE_KEY)) as { [STORAGE_KEY]?: QueuedSave[] };
  return stored[STORAGE_KEY] ?? [];
}

/** Sets the retry alarm unless it is set: setting it again would push the next try back. */
async function startRetrying() {
  if (!(await browser.alarms.get(RETRY_ALARM))) {
    await browser.alarms.create(RETRY_ALARM, { periodInMinutes: 0.5 });
  }
}

/**
 * Sets the retry alarm when saves wait. Chrome drops alarms when the extension updates, and may
 * on a browser restart: the service worker calls this as it starts, and after a sign-in.
 */
export async function ensureRetrying() {
  if ((await read()).length > 0) await startRetrying();
}

/** Stops retrying until `ensureRetrying` or the next enqueue: nothing can be sent signed out. */
export async function pauseRetrying() {
  await browser.alarms.clear(RETRY_ALARM);
}

/**
 * Changes to the queue run one after another: an enqueue and the end of a send both read and
 * write the whole list, and must not undo each other.
 */
let changes = Promise.resolve();

function change(edit: (saves: QueuedSave[]) => QueuedSave[]): Promise<QueuedSave[]> {
  const run = changes.then(async () => {
    const saves = edit(await read());
    await browser.storage.local.set({ [STORAGE_KEY]: saves });
    if (saves.length > 0) await startRetrying();
    else await browser.alarms.clear(RETRY_ALARM);
    return saves;
  });
  changes = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** The saves waiting to be sent, oldest first. */
export const queuedSaves = read;

/**
 * Keeps a save to send when the browser is back online, unless the same save already waits. The
 * page's text makes entries large; when storage has no room for it, the save is kept without it
 * (the server then fetches the page itself) rather than lost.
 */
export async function enqueue(save: PendingSave & SavedFrom): Promise<void> {
  const add = (entry: PendingSave & SavedFrom) =>
    change((saves) =>
      saves.some((queued) => sameSave(queued, entry))
        ? saves
        : [...saves, { ...entry, id: crypto.randomUUID(), failures: 0 }],
    );
  try {
    await add(save);
  } catch (error) {
    if (!save.page) throw error;
    console.error("Couldn't keep the page's text with a queued save", error);
    const { page: _page, ...withoutPage } = save;
    await add(withoutPage);
  }
}

/** A run through the queue in flight: a second call while one runs waits for it instead. */
let sending: Promise<void> | undefined;

/**
 * Sends the queued saves, oldest first, through `send`. A save leaves the queue only once it was
 * sent (or will never be), so one interrupted mid-send is tried again, and the server's dedupe
 * makes that harmless.
 */
export function sendQueued(send: (save: QueuedSave) => Promise<SendOutcome>): Promise<void> {
  sending ??= (async () => {
    try {
      for (const save of await read()) {
        let outcome: SendOutcome;
        try {
          outcome = await send(save);
        } catch (error) {
          console.error("Couldn't send a queued save", error);
          outcome = "failed";
        }
        if (outcome === "later") return;
        if (outcome === "failed" && save.failures + 1 < MAX_FAILURES) {
          await change((saves) =>
            saves.map((queued) =>
              queued.id === save.id ? { ...queued, failures: queued.failures + 1 } : queued,
            ),
          );
          return;
        }
        if (outcome === "failed") console.error(`Gave up on a save after ${MAX_FAILURES} tries`);
        await change((saves) => saves.filter((queued) => queued.id !== save.id));
      }
    } finally {
      sending = undefined;
    }
  })();
  return sending;
}

/**
 * Forgets every waiting save, when the user signs out: their pages and selections must not go to
 * whoever signs in next.
 */
export async function clearQueue(): Promise<void> {
  await change(() => []);
}
