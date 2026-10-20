import { browser, type Browser } from "wxt/browser";

import { saveNote } from "@/lib/api.ts";
import { NOTE_PORT, type NotePortMessage, type NotePortReply } from "@/lib/messages.ts";
import { openOnboarding } from "@/lib/onboarding.ts";
import { acceptSharedPalette } from "@/lib/palette.ts";
import { answerPopup } from "@/lib/popup-requests.ts";
import { registerQuickSave } from "@/lib/save-triggers.ts";

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
    acceptSharedPalette(message, sender).catch((error: unknown) =>
      console.error("Couldn't keep the shared palette", error),
    );
  });

  browser.runtime.onMessage.addListener(answerPopup);

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === NOTE_PORT) keepNote(port);
  });

  registerQuickSave();
});
