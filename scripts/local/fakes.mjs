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
// A research brief (a request with the web_search_20260209 tool) gets text with two
// web_search_result_location citations (https://example.com/fake-source-1 and -2), the matching
// server_tool_use and web_search_tool_result blocks, and usage with two web searches (or the
// `searches=` of a [fake-usage] marker), straight away.
//
// The Message Batches API (/v1/messages/batches): a create answers "in_progress"; a retrieve
// answers "ended", with a results_url, once FAKE_BATCH_DELAY_MS (default 0) has passed; the
// results are JSONL, each request answered as a normal call would be. A [fake-batch errored] or
// [fake-batch expired] marker in a request's message gives that outcome for the request, and a
// [fake-error spend-limit|credit|tier-cap] marker makes the create itself fail with that error.
//
// A librarian request (a forced plan_tags, plan_folders, plan_links, plan_topic_pages or
// confirm_links tool) gets a deterministic plan read off the library in its system prompt: tags
// "<x>" and "<x>s" merge, a tag with capitals is renamed to lowercase, items and tags go in a
// folder named for their first tag (items with none in "Notes"), the first two items that share a
// tag are linked, and each tag with 3+ items gets a topic page. Every change is "high" confidence
// unless the library (a note's text, say) holds [fake-confidence low].
//
// A lesson request (a forced write_lesson tool) gets a short lesson on the topic named in the
// message (inside <topic>, else "recent reading"), headed by a level-two heading, with a four-choice quiz, a recap when
// the message holds a <previous_lesson> (empty when not), and the first two saved items it lists
// (C1, C2) as its sources.
import { createHash, createHmac } from "node:crypto";
import http from "node:http";

import {
  addMilliseconds,
  constructNow,
  differenceInMilliseconds,
  getTime,
  getUnixTime,
} from "date-fns";

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

/** A request's system prompt as text: a string, or a list of text blocks. */
function systemText(system) {
  return Array.isArray(system)
    ? system.map((block) => block.text ?? "").join("\n")
    : String(system ?? "");
}

/**
 * The triage verdict for a save: worth researching when its text names one of the domains listed
 * one per line in the system prompt's <research_domains> (the first it names, as listed), unless a
 * `[fake-research no]` marker says otherwise.
 */
function researchVerdict(system, message) {
  const listed = /<research_domains>\n([\s\S]*?)\n<\/research_domains>/.exec(system)?.[1] ?? "";
  const domains = listed.split("\n").filter(Boolean);
  const text = message.toLowerCase();
  const domain = domains.find((candidate) => text.includes(candidate.toLowerCase()));
  if (!domain || /\[fake-research no\]/.test(message)) {
    return { worth: false, domain: "", reason: "Not mainly about one of the research domains." };
  }
  return { worth: true, domain, reason: `The save is about ${domain}.` };
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

/** The input a forced `write_lesson` call gets, read off the lesson request's message. */
function lessonInput(message) {
  // With no tag to teach, there is no <topic> and the message asks the model to choose.
  const topic = /<topic>\n([\s\S]*?)\n<\/topic>/.exec(message)?.[1]?.trim() || "recent reading";
  const refs = [...message.matchAll(/^(C\d+) \((?:link|note), saved/gm)].map((m) => m[1]);
  const previous = /^Topic: (.*)$/m.exec(
    /<previous_lesson>\n([\s\S]*?)\n<\/previous_lesson>/.exec(message)?.[1] ?? "",
  )?.[1];
  return {
    topic: `A first look at ${topic}`,
    body: [
      `## Why ${topic} matters`,
      "",
      `A stand-in lesson about ${topic}. It explains the main idea in plain words, then shows where it shows up in practice.`,
      "",
      "## The key idea",
      "",
      "Start from the smallest example that works, then add one constraint at a time.",
      "",
      "- First, name the thing you are building on.",
      "- Then, change one part and watch what moves.",
      "",
      "## Where to go next",
      "",
      "Read the saved items again with this frame in mind.",
    ].join("\n"),
    quiz: {
      question: `What is the best way to start learning ${topic}?`,
      choices: [
        "Start from the smallest working example",
        "Read everything before trying anything",
        "Skip the basics",
        "Memorise the terms",
      ],
      answer_index: 0,
      explanation: "A small working example gives you something to change and observe.",
    },
    recap: previous
      ? `Last time was ${previous}. This lesson builds on it: the same habit of starting small applies here.`
      : "",
    source_refs: refs.slice(0, 2),
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

const ANTHROPIC_PORT = Number(process.env.FAKE_ANTHROPIC_PORT ?? 8081);
// How long a batch stays "in_progress" after it is created.
const BATCH_DELAY_MS = Number(process.env.FAKE_BATCH_DELAY_MS ?? 0);

/** The text of a request's first message, where the `[fake-…]` markers are. */
function requestText(payload) {
  const content = payload.messages?.[0]?.content ?? "";
  return Array.isArray(content)
    ? content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
    : String(content);
}

/** True for a request that carries the web search tool: a research brief. */
const isBriefRequest = (payload) =>
  Boolean(payload.tools?.some((tool) => tool.type === "web_search_20260209"));

/**
 * A research brief: a server-side web search, then text with two citations. The title is read
 * from the `Title:` line of the clipping in the message. Usage counts two searches unless a
 * `[fake-usage …]` marker says otherwise.
 */
function briefReply(payload, message, body) {
  const title = /^Title: (.*)$/m.exec(message)?.[1] ?? "the page";
  const sources = [1, 2].map((n) => ({
    type: "web_search_result",
    url: `https://example.com/fake-source-${n}`,
    title: `Fake source ${n}`,
    encrypted_content: "x",
    page_age: null,
  }));
  const cited = (source, text) => ({
    type: "text",
    text,
    citations: [
      {
        type: "web_search_result_location",
        url: source.url,
        title: source.title,
        cited_text: "A stand-in passage.",
        encrypted_index: "x",
      },
    ],
  });
  const usage = replyUsage(message, body);
  usage.server_tool_use ??= { web_search_requests: 2 };
  return {
    id: "msg_local",
    type: "message",
    role: "assistant",
    model: payload.model,
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [
      {
        type: "server_tool_use",
        id: "srvtoolu_local",
        name: "web_search",
        input: { query: title },
      },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_local", content: sources },
      cited(sources[0], `## What it is\n\nA stand-in research brief about ${title}. `),
      cited(sources[1], `It has been written about elsewhere. [Fake source 2](${sources[1].url})`),
    ],
    usage,
  };
}

const batches = new Map();
let batchCount = 0;

/**
 * The batch as the API describes it: ended once `FAKE_BATCH_DELAY_MS` has passed since it was
 * created (`created` describes the create's own reply, which is always in progress).
 */
function describeBatch(batch, origin, { created = false } = {}) {
  const ended =
    !created &&
    differenceInMilliseconds(constructNow(undefined), batch.createdAt) >= BATCH_DELAY_MS;
  const counts = { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0 };
  if (ended) counts.succeeded = batch.requests.length;
  else counts.processing = batch.requests.length;
  return {
    id: batch.id,
    type: "message_batch",
    processing_status: ended ? "ended" : "in_progress",
    request_counts: counts,
    created_at: batch.createdAt.toISOString(),
    expires_at: addMilliseconds(batch.createdAt, 86_400_000).toISOString(),
    ended_at: ended ? addMilliseconds(batch.createdAt, BATCH_DELAY_MS).toISOString() : null,
    archived_at: null,
    cancel_initiated_at: null,
    results_url: ended ? `${origin}/v1/messages/batches/${batch.id}/results` : null,
  };
}

/** One request's result, computed like a normal call: by asking the Messages endpoint. */
async function batchResult({ custom_id, params }) {
  const text = requestText(params);
  const marker = /\[fake-batch (errored|expired)\]/.exec(text)?.[1];
  if (marker === "expired") return { custom_id, result: { type: "expired" } };
  const failed = (type, message) => ({
    custom_id,
    result: { type: "errored", error: { type: "error", error: { type, message } } },
  });
  if (marker === "errored") return failed("api_error", "Fake batch error");
  const answer = await fetch(`http://127.0.0.1:${ANTHROPIC_PORT}/v1/messages`, {
    method: "POST",
    body: JSON.stringify(params),
  });
  const reply = await answer.json();
  return answer.ok
    ? { custom_id, result: { type: "succeeded", message: reply } }
    : failed(reply.error?.type ?? "api_error", reply.error?.message ?? `HTTP ${answer.status}`);
}

/** The Message Batches API: create, retrieve and the JSONL results. */
async function handleBatches(request, response, payload) {
  const path = new URL(request.url, "http://fake").pathname;
  const origin = `http://${request.headers.host}`;
  const json = (status, value, type = "application/json") => {
    response.writeHead(status, { "content-type": type });
    response.end(value);
  };
  if (request.method === "POST" && path === "/v1/messages/batches") {
    // The create is what a workspace limit refuses, whatever the batch holds.
    const refused = (payload.requests ?? [])
      .map(
        ({ params }) =>
          /\[fake-error (spend-limit|credit|tier-cap)\]/.exec(requestText(params))?.[1],
      )
      .find(Boolean);
    if (refused) {
      const [status, type, text] = ERROR_REPLIES[refused];
      console.log(`[anthropic] batch create -> ${status} ${type}`);
      return json(
        status,
        JSON.stringify({ type: "error", error: { type, message: text }, request_id: "req_local" }),
      );
    }
    batchCount += 1;
    const batch = {
      id: `msgbatch_fake_${batchCount}`,
      createdAt: constructNow(undefined),
      requests: payload.requests ?? [],
    };
    batches.set(batch.id, batch);
    console.log(`[anthropic] batch ${batch.id} created with ${batch.requests.length} requests`);
    return json(200, JSON.stringify(describeBatch(batch, origin, { created: true })));
  }
  const match = /^\/v1\/messages\/batches\/([^/]+)(\/results)?$/.exec(path);
  const batch = match && batches.get(match[1]);
  if (request.method !== "GET" || !batch)
    return json(
      404,
      JSON.stringify({
        type: "error",
        error: { type: "not_found_error", message: "No such batch" },
      }),
    );
  if (!match[2]) return json(200, JSON.stringify(describeBatch(batch, origin)));
  const results = await Promise.all(batch.requests.map(batchResult));
  json(200, results.map((result) => JSON.stringify(result)).join("\n"), "application/x-jsonl");
}

listen(ANTHROPIC_PORT, "fake anthropic", (request, response, body) => {
  const payload = JSON.parse(body || "{}");
  if (request.url?.startsWith("/v1/messages/batches")) {
    return handleBatches(request, response, payload);
  }
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
  if (isBriefRequest(payload)) {
    console.log(`[anthropic] ${request.url} model=${payload.model} brief`);
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(JSON.stringify(briefReply(payload, message, body)));
  }
  if (payload.tool_choice?.name === "write_lesson") {
    console.log(`[anthropic] ${request.url} model=${payload.model} lesson`);
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
            name: "write_lesson",
            input: lessonInput(message),
          },
        ],
        usage: replyUsage(message, body),
      }),
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
  // Present when the tool asks for a research verdict (the user has research domains).
  const researches = Boolean(payload.tools?.[0]?.input_schema?.properties?.research);
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
              ...(researches
                ? { research: researchVerdict(systemText(payload.system), message) }
                : {}),
            },
          },
        ],
        usage: replyUsage(message, body),
      }),
    );
  }, MODEL_DELAY_MS);
});

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
