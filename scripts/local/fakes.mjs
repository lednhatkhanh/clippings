// Stand-ins for the services the app calls out to, so a change can be tried in a browser without
// credentials: QStash (accepts a publish or a batch, then makes a signed delivery with retries,
// like the real one), the Anthropic Messages API (answers the page-reading tool call after a short
// delay, and a streamed question over search results with an answer that cites the first one) and
// Voyage AI's embeddings API (a vector built from the words, so texts that share words
// are close).
//
//   node scripts/local/fakes.mjs        QStash on :8080, Anthropic on :8081, Voyage AI on :8082
//
// `scripts/local/local.env` points the app at them. Local development only.
import { createHash, createHmac } from "node:crypto";
import http from "node:http";

import { constructNow, getTime, getUnixTime } from "date-fns";

const SIGNING_KEY = "local-current-key"; // QSTASH_CURRENT_SIGNING_KEY in local.env
const RETRY_AFTER_MS = 1000;
const MODEL_DELAY_MS = 4000; // long enough to see the "Reading the page…" state
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

listen(8080, "fake qstash", (request, response, body) => {
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
 * one new tag, the first long word of the page's title.
 */
function suggestTags(message, title) {
  const listed = /<your_tags>\n([\s\S]*?)\n<\/your_tags>/.exec(message)?.[1] ?? "";
  const mine = listed === "(none yet)" ? [] : listed.split("\n").filter(Boolean);
  const word = (title ?? "").toLowerCase().match(/\p{L}{4,}/u)?.[0] ?? "reading";
  return { existing_tags: mine.slice(0, 2), new_tags: [word] };
}

/**
 * The weekly digest, when asked for: one group of all the week's clippings (the ids in
 * `<this_week>`) and the first archive clipping (in `<archive>`) brought back.
 */
function weeklyDigest(message) {
  const idsIn = (tag) => {
    const section = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(message)?.[1] ?? "";
    return [...section.matchAll(/<clipping id="([^"]+)">/g)].map((match) => match[1]);
  };
  const [first] = idsIn("archive");
  return {
    groups: [
      {
        title: "This week's reading",
        summary: "A stand-in summary of everything saved this week.",
        clippingIds: idsIn("this_week"),
      },
    ],
    resurfaced: first ? [{ clippingId: first, why: "A stand-in reason it fits this week." }] : [],
  };
}

const STREAM_DELAY_MS = 60;

/** One server-sent event, as the Messages API streams it. */
const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/**
 * A streamed answer to a question asked over `search_result` blocks (the ask page), in Markdown: a
 * lead-in, then a list whose first item quotes the first result as a cited passage. Like the real
 * API, each cited passage is its own text block whose citation comes before its text. Streamed in
 * small deltas so the page shows the answer arriving.
 */
function streamAnswer(payload, response) {
  const content = payload.messages?.at(-1)?.content ?? [];
  const first = content.find((block) => block.type === "search_result");
  const passage = String(first.content?.[0]?.text ?? "").slice(0, 160);
  console.log(`[anthropic] ask model=${payload.model} results=${content.length - 1}`);

  const citation = {
    type: "search_result_location",
    cited_text: passage,
    search_result_index: 0,
    source: first.source,
    title: first.title,
    start_block_index: 0,
    end_block_index: 1,
  };
  const words = (text) => text.match(/\s*\S+\s*/g) ?? [];
  const blocks = [
    { text: "Your clippings cover it:\n\n- **What they say:** " },
    { citation, text: passage },
    { text: "\n- **What else:** nothing more on this." },
  ];
  // Each block as its start, its deltas (a citation first) and its stop.
  const events = blocks.flatMap((block, index) => [
    ["content_block_start", { index, content_block: { type: "text", text: "", citations: [] } }],
    ...(block.citation
      ? [["content_block_delta", { index, delta: { type: "citations_delta", citation } }]]
      : []),
    ...words(block.text).map((text) => [
      "content_block_delta",
      { index, delta: { type: "text_delta", text } },
    ]),
    ["content_block_stop", { index }],
  ]);

  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  response.write(
    sse("message_start", {
      message: {
        id: "msg_local",
        type: "message",
        role: "assistant",
        model: payload.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    }),
  );
  let next = 0;
  const step = () => {
    const event = events[next++];
    if (!event) {
      response.write(
        sse("message_delta", {
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 10 },
        }),
      );
      response.end(sse("message_stop", {}));
      return;
    }
    response.write(sse(...event));
    setTimeout(step, STREAM_DELAY_MS);
  };
  step();
}

listen(8081, "fake anthropic", (request, response, body) => {
  const payload = JSON.parse(body || "{}");
  const asked = payload.messages?.at(-1)?.content;
  if (
    payload.stream &&
    Array.isArray(asked) &&
    asked.some((block) => block.type === "search_result")
  ) {
    return streamAnswer(payload, response);
  }
  // The content is a string or a list of blocks (a PDF comes as a document block before the text).
  const content = payload.messages?.[0]?.content ?? "";
  const message = Array.isArray(content)
    ? content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
    : String(content);
  const digests = payload.tool_choice?.name === "save_digest";
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
            input: digests
              ? weeklyDigest(message)
              : {
                  title: `Read: ${title ?? "Untitled"}`,
                  summary: "A stand-in summary of the page. It says what the page is about.",
                  excerpt: "A stand-in passage copied from the page.",
                  ...(suggests ? suggestTags(message, title) : {}),
                },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
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

listen(8082, "fake voyage", (request, response, body) => {
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
      usage: { total_tokens: inputs.length },
    }),
  );
});
