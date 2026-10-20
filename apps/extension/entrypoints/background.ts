import { browser, type Browser } from "wxt/browser";

import { listTags, refreshPalette, saveClipping, saveNote, saveTags } from "@/lib/api.ts";
import { isSignedIn, signIn, signOut, takeSignInProblem } from "@/lib/auth.ts";
import {
  NOTE_PORT,
  type NotePortMessage,
  type NotePortReply,
  type PopupRequest,
  type PopupResponses,
  type TagsReply,
} from "@/lib/messages.ts";
import { openOnboarding } from "@/lib/onboarding.ts";
import { acceptSharedPalette } from "@/lib/palette.ts";

/**
 * Tag saves, one after another, so an older choice never lands after a newer one. It only lives
 * as long as the service worker, which a save in flight keeps alive.
 */
let tagSaves: Promise<unknown> = Promise.resolve();

function queueTags(clippingId: string, tags: string[]): Promise<TagsReply> {
  const saved = tagSaves.then(() => saveTags(clippingId, tags));
  tagSaves = saved;
  return saved;
}

/** Signs in, then seeds the palette from the user's settings for the extension's pages. */
async function signInAndSeed(): Promise<boolean> {
  const signedIn = await signIn();
  if (signedIn) await refreshPalette();
  return signedIn;
}

async function answer(request: PopupRequest): Promise<PopupResponses[PopupRequest["type"]]> {
  switch (request.type) {
    case "status":
      return { signedIn: await isSignedIn(), signInProblem: await takeSignInProblem() };
    case "signIn":
      return { signedIn: await signInAndSeed() };
    case "signOut":
      await signOut();
      return { signedIn: false };
    case "save":
      return saveClipping(request.url);
    case "tags":
      return { tags: await listTags() };
    case "setTags":
      return queueTags(request.clippingId, request.tags);
    case "refreshPalette":
      return { palette: await refreshPalette() };
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
  browser.runtime.onInstalled.addListener((details) => void openOnboarding(details));
  // A Clippings page telling the extension the palette the user just picked.
  browser.runtime.onMessageExternal.addListener((message, sender) => {
    void acceptSharedPalette(message, sender);
  });

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
