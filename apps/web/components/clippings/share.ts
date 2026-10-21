/** What a share sends: the shown title and the original page's address, nothing else. */
export interface ShareLink {
  title: string;
  url: string;
}

/** What the browser offers: `share` is missing where there is no share sheet. */
export interface ShareEnv {
  share?: (link: ShareLink) => Promise<void>;
  copy: (text: string) => Promise<void>;
}

/** How a share or copy ended, for the toast: "cancelled" says nothing. */
export type ShareOutcome = "shared" | "cancelled" | "copied" | "failed";

const isAbort = (error: unknown) =>
  typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";

/** Copies the address; "failed" when the browser refuses. */
export async function copyLink(url: string, env: Pick<ShareEnv, "copy">): Promise<ShareOutcome> {
  try {
    await env.copy(url);
    return "copied";
  } catch {
    return "failed";
  }
}

/**
 * Hands the title and address to the share sheet. Closing the sheet (an `AbortError`) is not an
 * error; any other failure, or a browser without a share sheet, copies the address instead.
 */
export async function shareLink(link: ShareLink, env: ShareEnv): Promise<ShareOutcome> {
  if (!env.share) return copyLink(link.url, env);
  try {
    await env.share({ title: link.title, url: link.url });
    return "shared";
  } catch (error) {
    if (isAbort(error)) return "cancelled";
    return copyLink(link.url, env);
  }
}
