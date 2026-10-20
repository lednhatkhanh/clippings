/**
 * The OAuth provider sends the user to sign-in and consent with the authorization request in the
 * query, signed. `ba_param` names every signed parameter and `sig` is the signature.
 */
const SIGNATURE = "sig";
const SIGNED_NAMES = "ba_param";

type PageSearchParams = Record<string, string | string[] | undefined>;

/**
 * The signed authorization request in a page's query, without the page's own parameters, or
 * undefined when the page wasn't reached from an authorization. Its signature is checked where
 * it's used.
 */
export function signedOAuthQuery(searchParams: PageSearchParams): string | undefined {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, item);
    }
  }
  if (!params.has(SIGNATURE)) return undefined;
  const signedNames = new Set(params.getAll(SIGNED_NAMES));
  if (signedNames.size === 0) return undefined;

  const signed = new URLSearchParams();
  for (const [key, value] of params) {
    if (key === SIGNATURE || key === SIGNED_NAMES || signedNames.has(key))
      signed.append(key, value);
  }
  return signed.toString();
}
