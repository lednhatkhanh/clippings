import { MAX_TAG_LENGTH, normalizeTagName } from "./tag.ts";

/** Why a name is not a canonical tag name. */
export type NotCanonicalReason =
  | "empty"
  | "too_long"
  | "not_lowercase"
  | "plural"
  | "near_duplicate";

export type CanonicalTagVerdict =
  | { ok: true; name: string }
  | { ok: false; reason: NotCanonicalReason };

/** Words that end in "s" and are singular anyway, or read the same either way. */
const SINGULAR_ENDING_IN_S = new Set([
  "aws",
  "bias",
  "canvas",
  "chaos",
  "cors",
  "dns",
  "gas",
  "gps",
  "https",
  "ides",
  "ios",
  "js",
  "kubernetes",
  "lens",
  "linux",
  "news",
  "postgres",
  "series",
  "sms",
  "species",
  "status",
]);

/** Endings that mark an "s" word as singular: class, status, analysis, physics. */
const SINGULAR_SUFFIXES = ["ss", "us", "is", "ics", "ous"];

/** Whether the word reads as a plural (a short word ending in "s", such as "css", does not). */
function isPlural(word: string): boolean {
  if (word.length <= 3 || !word.endsWith("s")) return false;
  if (SINGULAR_ENDING_IN_S.has(word)) return false;
  return !SINGULAR_SUFFIXES.some((suffix) => word.endsWith(suffix));
}

/** The word in the singular, for comparing names: "libraries" and "library" are one. */
function singular(word: string): string {
  if (!isPlural(word)) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(sses|xes|ches|shes|zes)$/.test(word)) return word.slice(0, -2);
  return word.slice(0, -1);
}

/** A name as near-duplicate detection sees it: singular words, no spaces or punctuation. */
function comparisonKey(name: string): string {
  const words = name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.map(singular).join("");
}

/** Whether two strings are at most one insertion, deletion or substitution apart. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  const skipA = a.slice(i + 1) === b.slice(i);
  const skipB = a.slice(i) === b.slice(i + 1);
  const swap = a.slice(i + 1) === b.slice(i + 1);
  return skipA || skipB || swap;
}

/** The shortest name that is compared by edit distance: below it one letter is a different word. */
const FUZZY_MIN_LENGTH = 5;

/**
 * Whether a tag name the model proposes as new may be created without asking. A canonical name is
 * lowercase, ends in a singular word and is not a near-duplicate of a tag the user has: the same
 * words ignoring case, spacing, punctuation and plurals ("web-frameworks" for "web framework"), or
 * one letter off in a name of 5+ characters ("typescrpt"). Anything else stays a suggestion.
 *
 * It is deliberately blunt: a false "no" costs the user one tap on a suggestion, a false "yes"
 * adds a stray tag to their set. Returns the name as it would be stored.
 */
export function checkCanonicalTagName(
  candidate: string,
  existing: readonly string[],
): CanonicalTagVerdict {
  const name = normalizeTagName(candidate);
  if (!name) return { ok: false, reason: "empty" };
  if (name.length > MAX_TAG_LENGTH) return { ok: false, reason: "too_long" };
  if (name !== name.toLowerCase()) return { ok: false, reason: "not_lowercase" };
  const lastWord = name.match(/[\p{L}\p{N}]+/gu)?.at(-1) ?? name;
  if (isPlural(lastWord)) return { ok: false, reason: "plural" };

  const key = comparisonKey(name);
  const duplicate = existing.some((other) => {
    const otherKey = comparisonKey(other);
    if (otherKey === key) return true;
    return (
      key.length >= FUZZY_MIN_LENGTH &&
      otherKey.length >= FUZZY_MIN_LENGTH &&
      withinOneEdit(key, otherKey)
    );
  });
  return duplicate ? { ok: false, reason: "near_duplicate" } : { ok: true, name };
}
