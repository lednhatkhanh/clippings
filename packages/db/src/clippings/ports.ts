/** Time, injected so tests decide what "now" is. */
export interface Clock {
  now: () => Date;
}

/** Starts background enrichment of a clipping. */
export interface JobPublisher {
  requestEnrichment: (clippingId: string) => Promise<void>;
}

/** What reading a web page yields. */
export interface FetchedPage {
  /** The page's own `<title>`, when it has one. */
  title: string | null;
  /** Its readable text, cut to what the summarizer can take. */
  text: string;
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
}

/** Reads a page the way a person would: a clean title, a short summary, a passage worth keeping. */
export interface Summarizer {
  summarize: (page: { url: string } & FetchedPage) => Promise<PageSummary>;
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
