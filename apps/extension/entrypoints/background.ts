import { browser, type Browser } from "wxt/browser";

import { saveClipping, saveNote } from "@/lib/api.ts";
import { isSignedIn, signIn, signOut, takeSignInProblem } from "@/lib/auth.ts";
import {
  NOTE_PORT,
  type NotePortMessage,
  type NotePortReply,
  type PopupRequest,
  type PopupResponses,
} from "@/lib/messages.ts";

async function answer(request: PopupRequest): Promise<PopupResponses[PopupRequest["type"]]> {
  switch (request.type) {
    case "status":
      return { signedIn: await isSignedIn(), signInProblem: await takeSignInProblem() };
    case "signIn":
      return { signedIn: await signIn() };
    case "signOut":
      await signOut();
      return { signedIn: false };
    case "save":
      return saveClipping(request.url);
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
});
