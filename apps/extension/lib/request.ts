/** How long a request to Clippings may take before it is given up on. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** A request that got no answer: the network or the server couldn't be reached, or it timed out. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Couldn't reach Clippings", { cause });
    this.name = "NetworkError";
  }
}

/**
 * `fetch` with a timeout. What `fetch` itself throws for a request that got no answer (a
 * TypeError for the network, a TimeoutError when the time runs out) becomes a `NetworkError`, so
 * callers can tell that from any other error, such as one in the code that reads the response.
 */
export async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const unanswered =
      error instanceof TypeError ||
      (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"));
    throw unanswered ? new NetworkError(error) : error;
  }
}
