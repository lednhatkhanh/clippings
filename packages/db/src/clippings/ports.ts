/** Time, injected so tests decide what "now" is. */
export interface Clock {
  now: () => Date;
}

/** Starts background enrichment of a clipping. */
export interface JobPublisher {
  requestEnrichment: (clippingId: string) => Promise<void>;
  /**
   * Starts enrichment of many clippings at once, each delayed so the jobs arrive spread evenly
   * over `spreadOverSeconds` instead of all together. For the import backlog.
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

/** Fetches a page over the network. Throws when the page can't be read. */
export interface PageFetcher {
  fetchPage: (url: string) => Promise<FetchedPage>;
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
