/**
 * Whether this browser can install the app, and how. Chromium fires `beforeinstallprompt` once a
 * page qualifies, often before Settings is open, so the listener registers as soon as a signed-in
 * page loads this module and keeps the event for the "Install app" row. iOS and iPadOS have no
 * prompt: the user adds the app from Safari's Share menu.
 */

/** Chromium's install event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** `prompt`: Chromium's install dialog. `ios`: Add to Home Screen steps. `null`: nothing to show. */
export type InstallOption = "prompt" | "ios" | null;

const STANDALONE_QUERY = "(display-mode: standalone)";

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function setDeferred(event: BeforeInstallPromptEvent | null) {
  deferred = event;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // No mini-infobar: installing is offered in Settings only.
    event.preventDefault();
    setDeferred(event as BeforeInstallPromptEvent);
  });
  window.addEventListener("appinstalled", () => setDeferred(null));
}

function isStandalone() {
  // iOS reports a Home Screen app through `navigator.standalone` as well.
  return (
    window.matchMedia(STANDALONE_QUERY).matches ||
    ("standalone" in navigator && navigator.standalone === true)
  );
}

/** Safari on an iPhone or iPad; iPadOS asks for desktop sites, so it reads as a Mac with touch. */
function isIosSafari() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
}

export function subscribeInstallOption(onChange: () => void) {
  listeners.add(onChange);
  const standalone = window.matchMedia(STANDALONE_QUERY);
  standalone.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    standalone.removeEventListener("change", onChange);
  };
}

export function getInstallOption(): InstallOption {
  if (isStandalone()) return null;
  if (deferred) return "prompt";
  return isIosSafari() ? "ios" : null;
}

/** Opens Chromium's install dialog. The event works once; Chromium fires a new one if dismissed. */
export async function promptInstall() {
  const event = deferred;
  if (!event) return;
  setDeferred(null);
  await event.prompt();
}
