import { browser, type Browser } from "wxt/browser";

import { saveNote } from "@/lib/api.ts";
import { isSignedIn, signIn, signOut, takeSignInProblem } from "@/lib/auth.ts";
import {
  NOTE_PORT,
  type NotePortMessage,
  type NotePortReply,
  type PopupRequest,
  type PopupResponses,
} from "@/lib/messages.ts";
import { clearQueue, ensureRetrying } from "@/lib/queue.ts";
import { saveFromPopup, sendOfflineSaves } from "@/lib/quick-save.ts";
import { registerQuickSave } from "@/lib/save-triggers.ts";

/** After a sign-in, the saves that waited for one go out, and retrying starts again. */
async function resumeOfflineSaves() {
  await ensureRetrying();
  await sendOfflineSaves();
}

async function answer(request: PopupRequest): Promise<PopupResponses[PopupRequest["type"]]> {
  switch (request.type) {
    case "status":
      return { signedIn: await isSignedIn(), signInProblem: await takeSignInProblem() };
    case "signIn": {
      const signedIn = await signIn();
      if (signedIn) void resumeOfflineSaves();
      return { signedIn };
    }
    case "signOut":
      await signOut();
      // Saves made offline are this account's: they must not go to the next one.
      await clearQueue();
      return { signedIn: false };
    case "save":
      return saveFromPopup(request.url);
  }
}

/**
 * The popup's note, saved from here so that nothing typed is lost when the popup closes: it
 * sends every keystroke as a draft, and closing it closes the port, which saves the last draft.
 * Saves run one after another, so the last text typed is the one that stays.
 */
function keepNote(port: Browser.runtime.Port) {
  let draft: { clippingId: string; note: string } | undefined;
  let savedNote: string | undefined;
  let queue = Promise.resolve();

  const save = () => {
    queue = queue.then(async () => {
      if (!draft || draft.note === savedNote) return;
      const { clippingId, note } = draft;
      const outcome = await saveNote(clippingId, note);
      if (outcome === "saved") savedNote = note;
      const reply: NotePortReply = { type: outcome, note };
      try {
        port.postMessage(reply);
      } catch {
        // The popup has closed; the save stands.
      }
    });
  };

  port.onMessage.addListener((message: NotePortMessage) => {
    if (message.type === "draft") draft = { clippingId: message.clippingId, note: message.note };
    else save();
  });
  port.onDisconnect.addListener(save);
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: PopupRequest, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    answer(message).then(sendResponse, (error: unknown) => {
      console.error("Couldn't answer the popup", error);
      sendResponse(undefined);
    });
    return true;
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === NOTE_PORT) keepNote(port);
  });

  registerQuickSave();
});
