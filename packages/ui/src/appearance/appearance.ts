import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_KEYS,
  APPEARANCE_VALUES,
  type Appearance,
  type AppearanceKey,
} from "@clippings/shared";

export const APPEARANCE_STORAGE_KEYS: Record<AppearanceKey, string> = {
  theme: "clippings.theme",
  palette: "clippings.palette",
  contrast: "clippings.contrast",
  density: "clippings.density",
};

/**
 * A one-shot handoff: the server sets this cookie right after sign-in so a new device gets the
 * user's saved settings before first paint. `NO_FLASH_SCRIPT` moves it into local storage and
 * deletes it.
 */
export const APPEARANCE_COOKIE = "clippings.appearance";

/** The cookie value (not the whole `Set-Cookie` line) that carries `appearance`. */
export const encodeAppearanceCookie = (appearance: Appearance): string =>
  encodeURIComponent(JSON.stringify(appearance));

/**
 * Inline script for `<head>`: sets the attributes before first paint. Per setting, a valid value
 * in the handoff cookie wins (and is mirrored to local storage, after which the cookie is
 * deleted), then a valid stored value, then the default. Written as a string, not a stringified
 * function, so bundler transforms can't change it. It never throws: private windows, blocked
 * storage and a malformed cookie fall back to the next source.
 */
export const NO_FLASH_SCRIPT = `(function(){var root=document.documentElement;var keys=${JSON.stringify(
  APPEARANCE_STORAGE_KEYS,
)};var values=${JSON.stringify(APPEARANCE_VALUES)};var defaults=${JSON.stringify(
  APPEARANCE_DEFAULTS,
)};var cookie=${JSON.stringify(APPEARANCE_COOKIE)};var handoff={};try{var parts=document.cookie.split(";");for(var i=0;i<parts.length;i++){var part=parts[i].replace(/^\\s+/,"");if(part.indexOf(cookie+"=")===0){try{var parsed=JSON.parse(decodeURIComponent(part.slice(cookie.length+1)));if(parsed&&typeof parsed==="object"){handoff=parsed}}catch(e){}document.cookie=cookie+"=; Max-Age=0; path=/";break}}}catch(e){}Object.keys(keys).forEach(function(name){var value=defaults[name];var carried=handoff[name];if(typeof carried==="string"&&values[name].indexOf(carried)!==-1){value=carried;try{localStorage.setItem(keys[name],value)}catch(e){}}else{try{var stored=localStorage.getItem(keys[name]);if(stored&&values[name].indexOf(stored)!==-1){value=stored}}catch(e){}}if(value==="system"){root.removeAttribute("data-"+name)}else{root.setAttribute("data-"+name,value)}})})();`;

interface ApplyTarget {
  root: Pick<HTMLElement, "setAttribute" | "removeAttribute">;
  storage?: Pick<Storage, "setItem">;
}

/**
 * Puts `appearance` on `<html>` the way `NO_FLASH_SCRIPT` does (`system` removes the attribute)
 * and mirrors it to local storage for the next page load. Blocked storage is ignored.
 */
export function applyAppearance(appearance: Appearance, target?: ApplyTarget): void {
  const root = target?.root ?? document.documentElement;
  let storage = target?.storage;
  if (!target?.storage) {
    try {
      storage = localStorage;
    } catch {
      // Blocked storage: the attributes still apply for this page.
    }
  }

  for (const key of APPEARANCE_KEYS) {
    const value = appearance[key];
    if (value === "system") root.removeAttribute(`data-${key}`);
    else root.setAttribute(`data-${key}`, value);
    try {
      storage?.setItem(APPEARANCE_STORAGE_KEYS[key], value);
    } catch {
      // Blocked or full storage is fine: the server copy is the source of truth.
    }
  }
}

const REVEAL_MS = 400;
const REVEAL_EASING = "cubic-bezier(0.05, 0.7, 0.1, 1)";
const TRANSITION_ATTRIBUTE = "data-appearance-transition";

/**
 * Runs `update` inside a view transition, so the page changes from the old look to the new one
 * instead of jumping. Without reduced motion the new look is revealed as a circle growing from
 * `origin` (default: the viewport center); with it, a short crossfade. Without
 * `document.startViewTransition`, `update` just runs.
 *
 * The browser snapshots the new state right after `update` returns, so React state set in it must
 * be committed synchronously: wrap the setter in `flushSync`.
 */
export function transitionAppearance(
  update: () => void,
  options?: { origin?: { x: number; y: number } },
): void {
  if (typeof document === "undefined" || typeof document.startViewTransition !== "function") {
    update();
    return;
  }

  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.setAttribute(TRANSITION_ATTRIBUTE, reduced ? "fade" : "reveal");

  const transition = document.startViewTransition(update);
  const clear = () => root.removeAttribute(TRANSITION_ATTRIBUTE);
  transition.finished.then(clear, clear);
  if (reduced) return;

  const x = options?.origin?.x ?? innerWidth / 2;
  const y = options?.origin?.y ?? innerHeight / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const easing =
    getComputedStyle(root)
      .getPropertyValue("--md-sys-motion-easing-emphasized-decelerate")
      .trim() || REVEAL_EASING;

  transition.ready.then(
    () => {
      root.animate(
        { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: REVEAL_MS, easing, pseudoElement: "::view-transition-new(root)" },
      );
    },
    () => {
      // The transition was skipped: the update already ran without animation.
    },
  );
}
