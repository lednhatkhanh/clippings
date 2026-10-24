/** Time, injected so tests decide what "now" is. */
export interface Clock {
  now: () => Date;
}

/** Starts background enrichment of a clipping. */
export interface JobPublisher {
  requestEnrichment: (clippingId: string) => Promise<void>;
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

/** What the summarizer reads: the page, and the user's tag names when they want suggestions. */
export type SummarizerInput = { url: string } & FetchedPage & {
    /**
     * The user's most-used tag names, when they have tag suggestions on (possibly none yet).
     * Undefined when suggestions are off: then no tag names leave the app and none are suggested.
     */
    userTags?: readonly string[];
  };

/** Reads a page the way a person would: a clean title, a short summary, a passage worth keeping. */
export interface Summarizer {
  summarize: (page: SummarizerInput) => Promise<PageSummary>;
}

/**
 * What a text is embedded for. Retrieval models embed a short query and the document it should
 * find differently, so each side says which it is.
 */
export type EmbeddingPurpose = "document" | "query";

/** Turns text into a vector of `EMBEDDING_DIMENSIONS` (schema.ts) numbers, close for texts close in meaning. */
export interface Embedder {
  embed: (text: string, purpose: EmbeddingPurpose) => Promise<number[]>;
}

/** A clipping as the digester reads it. */
export interface DigestClipping {
  id: string;
  title: string;
  summary: string | null;
  /** The user's tag names on it. */
  tags: string[];
  note: string;
}

/** What the digester reads: one finished week of a user's clippings, and some older ones. */
export interface DigesterInput {
  /** The week's Monday, `yyyy-MM-dd` (UTC). */
  weekStart: string;
  /** Everything saved that week, newest first. */
  clippings: DigestClipping[];
  /** Up to 3 older clippings related to the week's, which the digest may bring back. */
  related: DigestClipping[];
}

/**
 * A user's digest of a week, as stored: the week's clippings in groups, and older ones worth
 * seeing again. Clippings are named by id, and every id comes from the digester's input.
 */
export interface WeeklyDigest {
  groups: { title: string; summary: string; clippingIds: string[] }[];
  resurfaced: { clippingId: string; why: string }[];
}

/** Writes the digest of a week: groups the clippings by theme and says why an older one is back. */
export interface Digester {
  digest: (input: DigesterInput) => Promise<WeeklyDigest>;
}
