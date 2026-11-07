// Stand-ins for the services the app calls out to, so a change can be tried in a browser without
// credentials: QStash (accepts a publish or a batch, then makes a signed delivery with retries,
// like the real one), the Anthropic Messages API (answers the page-reading tool call after a short
// delay) and Voyage AI's embeddings API (a vector built from the words, so texts that share words
// are close).
//
//   node scripts/local/fakes.mjs        QStash on :8080, Anthropic on :8081, Voyage AI on :8082
//
// `scripts/local/local.env` points the app at them. Local development only.
//
// A test that starts the fakes itself moves them with FAKE_QSTASH_PORT, FAKE_ANTHROPIC_PORT and
// FAKE_VOYAGE_PORT, and skips the 4 s model delay with FAKE_MODEL_DELAY_MS=0.
//
// The Anthropic fake reports `usage` on every reply and fails on request. Put a marker in the
// message text:
//   [fake-usage input=1000 output=200 cache_read=5000 cache_write=300 searches=2]
//       sets the reply's usage (fields left out are 0; with no marker, input is the request's
//       characters over four and output is 10)
//   [fake-error spend-limit]   HTTP 400, the workspace usage limit reached
//   [fake-error credit]        HTTP 400, "credit balance is too low"
//   [fake-error tier-cap]      HTTP 429 with no retry-after, an account's spend cap
//   [fake-error rate-limit]    HTTP 429 with retry-after, an ordinary rate limit
//   [fake-error overloaded]    HTTP 529
//
// A librarian request (a forced plan_tags, plan_folders, plan_links, plan_topic_pages or
// confirm_links tool) gets a deterministic plan read off the library in its system prompt: tags
// "<x>" and "<x>s" merge, a tag with capitals is renamed to lowercase, items and tags go in a
// folder named for their first tag (items with none in "Notes"), the first two items that share a
// tag are linked, and each tag with 3+ items gets a topic page. Every change is "high" confidence
// unless the library (a note's text, say) holds [fake-confidence low].
import { createHash, createHmac } from "node:crypto";
import http from "node:http";

import { constructNow, getTime, getUnixTime } from "date-fns";

const SIGNING_KEY = "local-current-key"; // QSTASH_CURRENT_SIGNING_KEY in local.env
const RETRY_AFTER_MS = 1000;
// Long enough to see the "Reading the page…" state.
const MODEL_DELAY_MS = Number(process.env.FAKE_MODEL_DELAY_MS ?? 4000);
// QStash's real `Upstash-Delay` is honoured up to this, so an import backlog spread over a day
// still drains visibly (all at once, after this long) instead of over hours.
const MAX_DELAY_MS = 5000;
const DELAY_UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** `Upstash-Delay` ("90s", "2h") in milliseconds, capped at `MAX_DELAY_MS`; 0 when absent. */
function delayMs(header) {
  const match = /^(\d+)([smhd])$/.exec(String(header ?? ""));
  return match ? Math.min(Number(match[1]) * DELAY_UNIT_MS[match[2]], MAX_DELAY_MS) : 0;
}

const base64url = (input) => Buffer.from(input).toString("base64url");

function sign(body, url) {
  const now = getUnixTime(constructNow(undefined));
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: "Upstash",
      sub: url,
      exp: now + 300,
      nbf: now - 10,
      iat: now,
      jti: `jwt_${now}`,
      body: createHash("sha256").update(body).digest("base64url"),
    }),
  );
  const signature = createHmac("sha256", SIGNING_KEY)
    .update(`${header}.${claims}`)
    .digest("base64url");
  return `${header}.${claims}.${signature}`;
}

async function deliver(url, body, headers, retries, attempt = 0) {
  const response = await fetch(url, {
    method: "POST",
    body,
    headers: {
      ...headers,
      "content-type": "application/json",
      "Upstash-Signature": sign(body, url),
      "Upstash-Retried": String(attempt),
    },
  }).catch(() => null);
  console.log(`[qstash] ${url} attempt ${attempt} -> ${response?.status ?? "no answer"}`);
  const delivered = response && response.status >= 200 && response.status < 300;
  const refused = response?.headers.get("Upstash-NonRetryable-Error");
  if (!delivered && !refused && attempt < retries) {
    setTimeout(() => deliver(url, body, headers, retries, attempt + 1), RETRY_AFTER_MS);
  }
}

function listen(port, name, handle) {
  http
    .createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => handle(request, response, body));
    })
    .listen(port, "127.0.0.1", () => console.log(`${name} on ${port}`));
}

const messageId = () => `msg_${getTime(constructNow(undefined))}`;

/** Takes one message the way QStash does: logs it, then delivers it after its delay. */
function accept(destination, headers, body) {
  const retries = Number(headers["upstash-retries"] ?? 3);
  const forwarded = Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => name.startsWith("upstash-forward-"))
      .map(([name, value]) => [name.slice("upstash-forward-".length), value]),
  );
  const delay = delayMs(headers["upstash-delay"]);
  console.log(`[qstash] publish ${destination} retries=${retries} delay=${delay}ms body=${body}`);
  setTimeout(() => deliver(destination, body, forwarded, retries), 300 + delay);
  return { messageId: messageId() };
}

listen(Number(process.env.FAKE_QSTASH_PORT ?? 8080), "fake qstash", (request, response, body) => {
  const publish = request.url?.match(/^\/v2\/publish\/(.+)$/);
  const batch = request.url === "/v2/batch";
  if (request.method !== "POST" || !(publish || batch)) return response.writeHead(404).end();

  response.writeHead(201, { "content-type": "application/json" });
  if (publish) {
    return response.end(
      JSON.stringify(accept(decodeURIComponent(publish[1]), request.headers, body)),
    );
  }
  // A batch is a JSON array of { destination, headers, body }, each message with its own headers
  // (the client sends them with their original capitalisation, so fold them like Node does).
  const messages = JSON.parse(body || "[]");
  console.log(`[qstash] batch of ${messages.length}`);
  response.end(
    JSON.stringify(
      messages.map((message) =>
        accept(
          message.destination,
          Object.fromEntries(
            Object.entries(message.headers ?? {}).map(([name, value]) => [
              name.toLowerCase(),
              value,
            ]),
          ),
          message.body,
        ),
      ),
    ),
  );
});

/**
 * Tag suggestions, when asked for: the first two of the user's tags (listed in `<your_tags>`) and
 * one new tag, the first long word of the page's title. Each is "low" confidence, so it stays a
 * suggestion, unless a `[fake-confidence high]` marker in the message asks for "high", which
 * auto-tagging applies.
 */
function suggestTags(message, title) {
  const listed = /<your_tags>\n([\s\S]*?)\n<\/your_tags>/.exec(message)?.[1] ?? "";
  const mine = listed === "(none yet)" ? [] : listed.split("\n").filter(Boolean);
  const word = (title ?? "").toLowerCase().match(/\p{L}{4,}/u)?.[0] ?? "reading";
  const confidence = /\[fake-confidence high\]/.test(message) ? "high" : "low";
  const tag = (name) => ({ name, confidence, reason: `The page is about ${name}.` });
  return { existing_tags: mine.slice(0, 2).map(tag), new_tags: [tag(word)] };
}

// Error replies a `[fake-error name]` marker asks for: status, type, message, retry-after seconds.
const ERROR_REPLIES = {
  "spend-limit": [
    400,
    "invalid_request_error",
    "You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.",
  ],
  credit: [
    400,
    "invalid_request_error",
    "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
  ],
  "tier-cap": [429, "rate_limit_error", "This request would exceed your account's spend limit."],
  "rate-limit": [429, "rate_limit_error", "This request would exceed your rate limit.", 5],
  overloaded: [529, "overloaded_error", "Overloaded"],
};

/** The error a `[fake-error …]` marker in the message asks for, or undefined. */
function requestedError(message) {
  const name = /\[fake-error ([\w-]+)\]/.exec(message)?.[1];
  return name ? ERROR_REPLIES[name] : undefined;
}

/** The usage a reply reports: a `[fake-usage …]` marker's numbers, or a size from the request. */
function replyUsage(message, requestBody) {
  const marker = /\[fake-usage([^\]]*)\]/.exec(message)?.[1];
  if (marker === undefined) {
    return { input_tokens: Math.ceil(requestBody.length / 4), output_tokens: 10 };
  }
  const count = (name) => Number(new RegExp(`${name}=(\\d+)`).exec(marker)?.[1] ?? 0);
  return {
    input_tokens: count("input"),
    output_tokens: count("output"),
    cache_read_input_tokens: count("cache_read"),
    cache_creation_input_tokens: count("cache_write"),
    server_tool_use: { web_search_requests: count("searches") },
  };
}

const LIBRARIAN_TOOLS = new Set([
  "plan_tags",
  "plan_folders",
  "plan_links",
  "plan_topic_pages",
  "confirm_links",
]);
const FOLDER_COLORS = ["blue", "green", "violet", "orange", "teal", "pink", "amber", "red"];
const capitalised = (name) => name.charAt(0).toUpperCase() + name.slice(1);

/** The input a librarian tool call gets, from the library listed in the request's system prompt. */
function librarianInput(payload, message) {
  const system = Array.isArray(payload.system)
    ? payload.system.map((block) => block.text).join("\n")
    : String(payload.system ?? "");
  const confidence = /\[fake-confidence low\]/.test(system + message) ? "low" : "high";
  const tags = [...system.matchAll(/^(T\d+) "(.*)" \((\d+) items?, (no folder|folder F\d+)/gm)].map(
    (m) => ({ ref: m[1], name: m[2], usage: Number(m[3]) }),
  );
  const items = [
    ...system.matchAll(/^(C\d+) (link|note) "(.*)" \[(.*)\] \((no folder|folder F\d+)\)/gm),
  ].map((m) => ({
    ref: m[1],
    kind: m[2],
    tags: m[4] === "no tags" ? [] : m[4].split(", "),
  }));
  const folders = [...system.matchAll(/^F\d+ "(.*)" color/gm)].map((m) => m[1].toLowerCase());
  const tool = payload.tool_choice.name;

  if (tool === "plan_tags") {
    const merges = tags.flatMap((tag) => {
      const target = tags.find((other) => tag.name === `${other.name}s`);
      return target
        ? [
            {
              source: tag.ref,
              target: target.ref,
              reason: `"${tag.name}" is the plural of "${target.name}".`,
              confidence,
            },
          ]
        : [];
    });
    const merged = new Set(merges.flatMap((m) => [m.source, m.target]));
    const renames = tags
      .filter((tag) => tag.name !== tag.name.toLowerCase() && !merged.has(tag.ref))
      .map((tag) => ({
        tag: tag.ref,
        name: tag.name.toLowerCase(),
        reason: "Tag names are lowercase.",
        confidence,
      }));
    const too_broad = tags
      .filter((tag) => tag.usage >= 10)
      .map((tag) => ({ tag: tag.ref, reason: `${tag.usage} items is a lot for one tag.` }));
    return { merges, renames, folds: [], too_broad };
  }

  if (tool === "plan_folders") {
    const wanted = (/File these in folders: ([^\n]*)/.exec(message)?.[1] ?? "")
      .split(" ")
      .filter(Boolean);
    const folderOf = (ref) => {
      const tag = tags.find((t) => t.ref === ref);
      if (tag) return capitalised(tag.name);
      const item = items.find((i) => i.ref === ref);
      return item?.tags[0] ? capitalised(item.tags[0]) : "Notes";
    };
    const moves = wanted.map((ref) => ({ ref, folder: folderOf(ref), confidence }));
    const created = [...new Set(moves.map((m) => m.folder))].filter(
      (name) => !folders.includes(name.toLowerCase()),
    );
    return {
      folders: created.map((name, i) => ({
        name,
        color: FOLDER_COLORS[i % FOLDER_COLORS.length],
        reason: `Everything about ${name.toLowerCase()}.`,
        confidence,
      })),
      moves,
    };
  }

  if (tool === "plan_links") {
    const byTag = new Map();
    for (const item of items) {
      const first = item.tags[0];
      if (first) byTag.set(first, [...(byTag.get(first) ?? []), item.ref]);
    }
    const pair = [...byTag.entries()].find(([, refs]) => refs.length >= 2);
    return {
      links: pair
        ? [{ a: pair[1][0], b: pair[1][1], reason: `Both are about ${pair[0]}.`, confidence }]
        : [],
    };
  }

  if (tool === "confirm_links") {
    const indexes = [...message.matchAll(/<pair index="(\d+)">/g)].map((m) => Number(m[1]));
    return { verdicts: indexes.map((index) => ({ index, keep: true })) };
  }

  // plan_topic_pages: lines like `T3 "css": C1 C2 C3`.
  const pages = [...message.matchAll(/^(T\d+) "(.*)": ([^\n]*)$/gm)].map((m) => ({
    tag: m[1],
    overview: `What has been saved about ${m[2]} so far.`,
    items: m[3]
      .split(" ")
      .filter(Boolean)
      .map((ref) => ({ ref, summary: `A saved item about ${m[2]}.` })),
    confidence,
  }));
  return { pages };
}

listen(
  Number(process.env.FAKE_ANTHROPIC_PORT ?? 8081),
  "fake anthropic",
  (request, response, body) => {
    const payload = JSON.parse(body || "{}");
    // The content is a string or a list of blocks (a PDF comes as a document block before the text).
    const content = payload.messages?.[0]?.content ?? "";
    const message = Array.isArray(content)
      ? content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n")
      : String(content);
    const failure = requestedError(message);
    if (failure) {
      const [status, type, text, retryAfter] = failure;
      console.log(`[anthropic] ${request.url} model=${payload.model} -> ${status} ${type}`);
      response.writeHead(status, {
        "content-type": "application/json",
        ...(retryAfter && { "retry-after": String(retryAfter) }),
      });
      return response.end(
        JSON.stringify({ type: "error", error: { type, message: text }, request_id: "req_local" }),
      );
    }
    if (LIBRARIAN_TOOLS.has(payload.tool_choice?.name)) {
      console.log(
        `[anthropic] ${request.url} model=${payload.model} librarian=${payload.tool_choice.name}`,
      );
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(
        JSON.stringify({
          id: "msg_local",
          type: "message",
          role: "assistant",
          model: payload.model,
          stop_reason: "tool_use",
          stop_sequence: null,
          content: [
            {
              type: "tool_use",
              id: "toolu_local",
              name: payload.tool_choice.name,
              input: librarianInput(payload, message),
            },
          ],
          usage: replyUsage(message, body),
        }),
      );
    }
    const title = /^Page title: (.*)$/m.exec(message)?.[1];
    // Present when the tool asks for suggestions (tag suggestions are on for the user).
    const suggests = Boolean(payload.tools?.[0]?.input_schema?.properties?.existing_tags);
    console.log(
      `[anthropic] ${request.url} model=${payload.model} title=${title} suggests=${suggests}`,
    );
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "msg_local",
          type: "message",
          role: "assistant",
          model: payload.model,
          stop_reason: "tool_use",
          stop_sequence: null,
          content: [
            {
              type: "tool_use",
              id: "toolu_local",
              name: payload.tool_choice?.name ?? "save_reading",
              input: {
                title: `Read: ${title ?? "Untitled"}`,
                summary: "A stand-in summary of the page. It says what the page is about.",
                excerpt: "A stand-in passage copied from the page.",
                ...(suggests ? suggestTags(message, title) : {}),
              },
            },
          ],
          usage: replyUsage(message, body),
        }),
      );
    }, MODEL_DELAY_MS);
  },
);

const EMBEDDING_DIMENSIONS = 1024; // EMBEDDING_DIMENSIONS in @clippings/db

/** One axis per word (hashed), so texts that share words point the same way. */
function embedWords(text) {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const word of words) {
    const axis = createHash("sha256").update(word).digest().readUInt32BE(0) % EMBEDDING_DIMENSIONS;
    vector[axis] += 1;
  }
  // A text with no words gets an axis of its own rather than a zero vector, which has no direction.
  if (words.length === 0) vector[0] = 1;
  return vector;
}

listen(Number(process.env.FAKE_VOYAGE_PORT ?? 8082), "fake voyage", (request, response, body) => {
  if (request.method !== "POST" || request.url !== "/v1/embeddings") {
    return response.writeHead(404).end();
  }
  const payload = JSON.parse(body || "{}");
  const inputs = [payload.input ?? []].flat();
  console.log(
    `[voyage] model=${payload.model} input_type=${payload.input_type} n=${inputs.length}`,
  );
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      object: "list",
      data: inputs.map((text, index) => ({
        object: "embedding",
        embedding: embedWords(text),
        index,
      })),
      model: payload.model,
      // About four characters a token, like the Anthropic fake.
      usage: { total_tokens: inputs.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0) },
    }),
  );
});
