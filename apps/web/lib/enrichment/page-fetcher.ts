import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

import type { PageFetcher } from "@clippings/db";

import { extractPage } from "./html-text.ts";
import { isPublicAddress } from "./public-address.ts";

const MAX_BYTES = 2_000_000;
// For the whole fetch, redirects included. With the summarizer's own limit it stays well inside
// the enrichment route's 60 s, so a slow page ends as an error that reaches `failed`, not as a
// function killed with the clipping still pending.
const FETCH_BUDGET_MS = 20_000;
const MAX_REDIRECTS = 5;
const READ_ACCEPT = "text/html,application/xhtml+xml,text/plain;q=0.8";
// A link check only needs the status line, so it takes the first chunk of the body and hangs up.
const CHECK_MAX_BYTES = 1_024;
// A link that hasn't answered in this long counts as gone for the check, so a run of timeouts is
// short: the service checks ten at once.
const CHECK_BUDGET_MS = 5_000;

export class PageFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageFetchError";
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** `dns.lookup` as the connect step calls it. Tests swap it to decide what a name resolves to. */
export type Lookup = (
  hostname: string,
  options: { all: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/**
 * DNS resolution that refuses internal addresses. It runs at connect time, so a name that
 * resolves differently on the second lookup (DNS rebinding) can't slip past a check made earlier.
 * `resolve` only supplies the addresses: the check on them is the same whoever answers.
 */
function publicOnlyLookup(resolve: Lookup) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback): void => {
    resolve(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(error, "", 0);
      const internal = addresses.find(({ address }) => !isPublicAddress(address));
      if (internal || addresses.length === 0) {
        return callback(new PageFetchError(`${hostname} is not a public address`), "", 0);
      }
      if (options.all) return callback(null, addresses);
      const [first] = addresses;
      return callback(null, first!.address, first!.family);
    });
  };
}

export interface PageFetcherOptions {
  /** Resolves host names. The real resolver by default. */
  lookup?: Lookup;
  /** Sockets for `http:` URLs. Lets a test reach a local server; none by default. */
  agent?: http.Agent;
  /** Where the body is cut off. */
  maxBytes?: number;
  /** For the whole fetch, redirects included. */
  budgetMs?: number;
  /** For the whole link check, redirects included. */
  checkBudgetMs?: number;
}

type RequestOptions = Required<Omit<PageFetcherOptions, "agent" | "budgetMs" | "checkBudgetMs">> &
  Pick<PageFetcherOptions, "agent"> & {
    /** The `Accept` header; the one a page read sends by default. */
    accept?: string;
  };

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** One request, without following a redirect. */
function requestOnce(
  url: URL,
  signal: AbortSignal,
  { lookup, agent, maxBytes, accept = READ_ACCEPT }: RequestOptions,
): Promise<RawResponse> {
  // An IP in the URL skips DNS, so `publicOnlyLookup` never sees it.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) {
    return Promise.reject(new PageFetchError(`${url.hostname} is not a public address`));
  }
  return new Promise((resolveResponse, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        lookup: publicOnlyLookup(lookup) as unknown as http.RequestOptions["lookup"],
        ...(agent && url.protocol === "http:" ? { agent } : {}),
        signal,
        headers: {
          "user-agent": "Clippings/1.0 (reads pages people saved)",
          accept,
          "accept-encoding": "identity",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const finish = () =>
          resolveResponse({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          // The start of a long page is enough to summarize it.
          if (size > maxBytes) response.destroy();
        });
        response.on("end", finish);
        response.on("close", finish);
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function decode(body: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/** Follows redirects itself so every hop is checked; the first answer that isn't one. */
async function follow(
  address: string,
  signal: AbortSignal,
  options: RequestOptions,
): Promise<RawResponse> {
  let url = new URL(address);
  for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new PageFetchError(`Not a web address: ${url.href}`);
    }
    const response = await requestOnce(url, signal, options);
    const { status, headers } = response;
    if (status >= 300 && status < 400 && headers.location) {
      url = new URL(headers.location, url);
      continue;
    }
    return response;
  }
  throw new PageFetchError("Too many redirects");
}

/** The real fetcher: follows redirects itself so every hop is checked, and never reaches an internal address. */
export function createPageFetcher({
  lookup = dnsLookup as Lookup,
  agent,
  maxBytes = MAX_BYTES,
  budgetMs = FETCH_BUDGET_MS,
  checkBudgetMs = CHECK_BUDGET_MS,
}: PageFetcherOptions = {}): PageFetcher {
  return {
    async fetchPage(address) {
      const { status, headers, body } = await follow(address, AbortSignal.timeout(budgetMs), {
        lookup,
        agent,
        maxBytes,
      });
      if (status < 200 || status >= 300) throw new PageFetchError(`The site answered ${status}`);

      const contentType = headers["content-type"] ?? "";
      const text = decode(body, contentType);
      if (/html/i.test(contentType) || (!contentType && /<html|<body/i.test(text))) {
        return extractPage(text);
      }
      if (/^text\/plain/i.test(contentType)) return { title: null, text: text.slice(0, 20_000) };
      throw new PageFetchError(`Can't read ${contentType || "this kind of file"}`);
    },

    async checkLink(address) {
      // A GET, not a HEAD: plenty of live sites answer HEAD with 405 or 404.
      try {
        const { status } = await follow(address, AbortSignal.timeout(checkBudgetMs), {
          lookup,
          agent,
          maxBytes: CHECK_MAX_BYTES,
          // Any kind of file is a link that works; a narrow Accept gets some servers' 406.
          accept: "*/*",
        });
        if (status >= 200 && status < 300) return "alive";
        // A 4xx other than "gone" says the site is there and won't say more (a bot wall, a login,
        // a rate limit): no evidence either way.
        const refused = status >= 400 && status < 500 && status !== 404 && status !== 410;
        return refused ? "unknown" : "dead";
      } catch {
        return "dead";
      }
    },
  };
}
