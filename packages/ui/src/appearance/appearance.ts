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

/**
 * How an appearance change animates. "fade": a slow crossfade, like evening light. "reveal": the
 * new look grows as a circle from the control. "none": it applies at once.
 */
export type AppearanceTransition = "reveal" | "fade" | "none";

/**
 * The transition a change to `key` gets: theme, palette and contrast crossfade, density just
 * reflows. Taking back a change after a failed save applies at once, so it doesn't look like a
 * second user action.
 */
export function appearanceTransitionFor(
  key: AppearanceKey,
  options?: { revert?: boolean },
): AppearanceTransition {
  if (options?.revert) return "none";
  if (key === "density") return "none";
  return "fade";
}

/** Used when the token can't be read; matches `--motion-duration-slow`. */
const REVEAL_FALLBACK_MS = 520;
const REVEAL_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const TRANSITION_ATTRIBUTE = "data-appearance-transition";

/** The appearance view transition still running, if any. */
let running: ViewTransition | undefined;

/** A CSS `<time>` (`400ms`, `0.4s`) in milliseconds, or `undefined` when it isn't one. */
function parseCssTime(value: string): number | undefined {
  const match = /^(-?[\d.]+)(ms|s)$/.exec(value.trim());
  if (!match) return undefined;
  const amount = Number.parseFloat(match[1]!);
  if (Number.isNaN(amount)) return undefined;
  return match[2] === "s" ? amount * 1000 : amount;
}

/**
 * Runs `update` inside a view transition, so the page changes from the old look to the new one
 * instead of jumping. `kind` (default "fade") picks the animation, see `appearanceTransitionFor`:
 * "fade" crossfades slowly (`base.css`), "reveal" grows the new look as a circle from `origin`
 * (default: the viewport center) over `--motion-duration-slow`, and "none" just runs `update`,
 * skipping the rest of any appearance transition still running. Under reduced motion every
 * animated change is the crossfade. Without `document.startViewTransition`, `update`
 * just runs.
 *
 * The browser snapshots the new state right after `update` returns, so React state set in it must
 * be committed synchronously: wrap the setter in `flushSync`.
 */
export function transitionAppearance(
  update: () => void,
  options?: { kind?: AppearanceTransition; origin?: { x: number; y: number } },
): void {
  const kind = options?.kind ?? "fade";
  if (typeof document === "undefined" || typeof document.startViewTransition !== "function") {
    update();
    return;
  }
  if (kind === "none") {
    // A transition still running would keep showing its snapshot over this change until it ends.
    running?.skipTransition();
    update();
    return;
  }

  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reveal = kind === "reveal" && !reduced;
  root.setAttribute(TRANSITION_ATTRIBUTE, reveal ? "reveal" : "fade");

  const transition = document.startViewTransition(update);
  running = transition;
  // A newer transition skips this one; its attribute stays until it finishes itself.
  const clear = () => {
    if (running !== transition) return;
    running = undefined;
    root.removeAttribute(TRANSITION_ATTRIBUTE);
  };
  transition.finished.then(clear, clear);
  if (!reveal) return;

  const x = options?.origin?.x ?? innerWidth / 2;
  const y = options?.origin?.y ?? innerHeight / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const style = getComputedStyle(root);
  const duration =
    parseCssTime(style.getPropertyValue("--motion-duration-slow")) ?? REVEAL_FALLBACK_MS;
  const easing = style.getPropertyValue("--motion-ease-settle").trim() || REVEAL_EASING;

  transition.ready.then(
    () => {
      root.animate(
        { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration, easing, pseudoElement: "::view-transition-new(root)" },
      );
    },
    () => {
      // The transition was skipped: the update already ran without animation.
    },
  );
}
