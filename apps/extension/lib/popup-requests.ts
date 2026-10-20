import { browser, type Browser } from "wxt/browser";

import { listTags, refreshPalette, saveTags } from "@/lib/api.ts";
import { isSignedIn, signIn, signOut, takeSignInProblem } from "@/lib/auth.ts";
import type { PopupRequest, PopupResponses, TagsReply } from "@/lib/messages.ts";
import { clearQueue, ensureRetrying } from "@/lib/queue.ts";
import { saveFromPopup, sendOfflineSaves } from "@/lib/quick-save.ts";

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

/** After a sign-in, the saves that waited for one go out, and retrying starts again. */
async function resumeOfflineSaves() {
  await ensureRetrying();
  await sendOfflineSaves();
}

/**
 * Signs in, then seeds the palette from the user's settings for the extension's pages, and sends
 * the saves that waited for a sign-in.
 */
async function signInAndSeed(): Promise<boolean> {
  const signedIn = await signIn();
  if (signedIn) {
    await refreshPalette();
    void resumeOfflineSaves();
  }
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
      // Saves made offline are this account's: they must not go to the next one.
      await clearQueue();
      return { signedIn: false };
    case "save":
      return saveFromPopup(request.url);
    case "tags":
      return { tags: await listTags() };
    case "setTags":
      return queueTags(request.clippingId, request.tags);
    case "refreshPalette":
      return { palette: await refreshPalette() };
  }
}

/**
 * The service worker's `runtime.onMessage` listener for the popup's requests. Only the extension's
 * own pages are answered: a message from any other sender is ignored.
 */
export function answerPopup(
  message: PopupRequest,
  sender: Browser.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): boolean {
  if (sender.id !== browser.runtime.id) return false;
  answer(message).then(sendResponse, (error: unknown) => {
    console.error("Couldn't answer the popup", error);
    sendResponse(undefined);
  });
  return true;
}
