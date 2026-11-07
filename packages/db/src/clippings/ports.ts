import type { ClippingKind } from "@clippings/shared";

/** Time, injected so tests decide what "now" is. */
export interface Clock {
  now: () => Date;
}

/** Starts background enrichment of a clipping. */
export interface JobPublisher {
  /**
   * `timeoutMs` bounds the wait for the queue to take the job: a save that must not be held up by
   * a slow queue passes it, and the publisher finishes the request in the background when it can.
   * Left out, the call waits for the queue.
   */
  requestEnrichment: (clippingId: string, options?: { timeoutMs?: number }) => Promise<void>;
  /**
   * Starts enrichment of many clippings at once, each delayed so the jobs arrive spread evenly
   * over `spreadOverSeconds` instead of all together (0: all at once). For the import backlog and
   * the stuck sweep.
   */
  requestEnrichments: (
    clippingIds: readonly string[],
    options: { spreadOverSeconds: number },
  ) => Promise<void>;
}

/** What reading a web page yields. */
export interface FetchedPage {
  /** The page's own `<title>`, when it has one. */
  title: string | null;
  /** Its readable text, cut to what the summarizer can take. Empty for a PDF, which is in `document`. */
  text: string;
  /**
   * The file itself, base64, when the page is a PDF the summarizer reads directly. Left out for
   * HTML and text pages.
   */
  document?: { mediaType: "application/pdf"; data: string };
}

/** Fetches a page over the network. */
export interface PageFetcher {
  /** Reads the page. Throws when it can't be read. */
  fetchPage: (url: string) => Promise<FetchedPage>;
  /**
   * Whether the page still answers: "alive" when it resolves to a 2xx, "dead" when it is gone (404,
   * 410, a 5xx, no such host, a refused connection, a timeout, an address the fetcher won't reach),
   * "unknown" when the site answers but won't say (401, 403, 406, 429 and other 4xx: bot walls and
   * rate limits). Never throws: one check says little, the service weighs several.
   */
  checkLink: (url: string) => Promise<"alive" | "dead" | "unknown">;
}

/** What the summarizer makes of a page. */
export interface PageSummary {
  title: string;
  summary: string;
  excerpt: string;
  /**
   * Tags the model suggests, when it was asked: at most 3 of the user's own (in their spelling)
   * and at most 1 new one. Left out when suggestions were off or the model's suggestions were
   * unusable.
   */
  suggestedTags?: string[];
}

/**
 * Thrown by a port when the model gateway refused a call because the user's daily cap is reached
 * (or Anthropic says a spend limit or the credit is exhausted). Not a failure: the work waits for
 * another day, so enrichment holds the clipping instead of retrying or failing it.
 */
export class CapReachedError extends Error {
  constructor() {
    super("The daily model spend cap is reached");
    this.name = "CapReachedError";
  }
}

/**
 * What the summarizer reads: the page (or, for a note, its body as `text`, with no `url`), and the
 * user's tag names when they want suggestions.
 */
export type SummarizerInput = {
  kind: ClippingKind;
  /** Null for a note. */
  url: string | null;
  userId: string;
} & FetchedPage & {
    /**
     * The user's most-used tag names, when they have tag suggestions on (possibly none yet).
     * Undefined when suggestions are off: then no tag names leave the app and none are suggested.
     */
    userTags?: readonly string[];
  };

/**
 * Reads a page the way a person would: a clean title, a short summary, a passage worth keeping.
 * Throws `CapReachedError` when the user's spend cap is reached.
 */
export interface Summarizer {
  summarize: (page: SummarizerInput) => Promise<PageSummary>;
}

/**
 * What a text is embedded for. Retrieval models embed a short query and the document it should
 * find differently, so each side says which it is.
 */
export type EmbeddingPurpose = "document" | "query";

/** Whose spend an embedding call counts toward, and for which job. */
export interface EmbeddingOwner {
  userId: string;
  /** "search" for a query the reader is waiting on, "enrich" for a clipping's own text. */
  jobKind: "enrich" | "search";
}

/**
 * Turns text into a vector of `EMBEDDING_DIMENSIONS` (schema.ts) numbers, close for texts close in
 * meaning. Throws `CapReachedError` when the owner's spend cap is reached.
 */
export interface Embedder {
  /** `signal` cancels the call, as when the reader has typed past a search. */
  embed: (
    text: string,
    purpose: EmbeddingPurpose,
    owner: EmbeddingOwner,
    signal?: AbortSignal,
  ) => Promise<number[]>;
  /** One vector per text, in order. For a backlog: one call instead of one per text. */
  embedMany: (
    texts: readonly string[],
    purpose: EmbeddingPurpose,
    owner: EmbeddingOwner,
  ) => Promise<number[][]>;
}
