import type { ExtensionSaveResponse, ExtensionSignInError } from "@clippings/shared";

/**
 * What the popup asks the service worker. The popup makes no network calls: the service worker
 * holds the tokens and calls the API.
 */
export type PopupRequest =
  | { type: "status" }
  | { type: "signIn" }
  | { type: "signOut" }
  | { type: "save"; url: string };

/** Why the last sign-in didn't finish, for the popup to say. */
export type SignInProblem = ExtensionSignInError | "cancelled" | "failed";

export interface StatusResponse {
  signedIn: boolean;
  /** Set until the popup has shown it once. */
  signInProblem: SignInProblem | null;
}

export type SaveResult =
  | { ok: true; saved: ExtensionSaveResponse }
  | { ok: false; reason: "signed_out" | "not_allowlisted" | "invalid_url" | "offline" | "failed" };

/** The answer to each request, by its type. */
export interface PopupResponses {
  status: StatusResponse;
  signIn: { signedIn: boolean };
  signOut: { signedIn: false };
  save: SaveResult;
}

/** The port the popup holds open while it's showing, named so the service worker knows it. */
export const NOTE_PORT = "note";

/**
 * Over the note port. The popup sends every keystroke as a draft, so the service worker holds the
 * latest text even if the popup closes mid-word, and asks to save it 400 ms after typing stops
 * and on blur. When the port closes, the service worker saves whatever is still unsaved.
 */
export type NotePortMessage =
  | { type: "draft"; clippingId: string; note: string }
  | { type: "save" };

/** The service worker's answer on the note port after each save, with the text it was for. */
export type NotePortReply = { type: "saved" | "gone" | "failed"; note: string };
