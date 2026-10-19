// Stand-ins for the services the app calls out to, so a change can be tried in a browser without
// credentials: QStash (accepts a publish, then makes a signed delivery with retries, like the real
// one), the Anthropic Messages API (answers the page-reading tool call after a short delay) and
// Voyage AI's embeddings API (a vector built from the words, so texts that share words are close).
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

listen(8080, "fake qstash", (request, response, body) => {
  const publish = request.url?.match(/^\/v2\/publish\/(.+)$/);
  if (request.method !== "POST" || !publish) return response.writeHead(404).end();

  const destination = decodeURIComponent(publish[1]);
  const retries = Number(request.headers["upstash-retries"] ?? 3);
  const forwarded = Object.fromEntries(
    Object.entries(request.headers)
      .filter(([name]) => name.startsWith("upstash-forward-"))
      .map(([name, value]) => [name.slice("upstash-forward-".length), value]),
  );
  console.log(`[qstash] publish ${destination} retries=${retries} body=${body}`);
  setTimeout(() => deliver(destination, body, forwarded, retries), 300);
  response.writeHead(201, { "content-type": "application/json" });
  response.end(JSON.stringify({ messageId: `msg_${getTime(constructNow(undefined))}` }));
});

listen(8081, "fake anthropic", (request, response, body) => {
  const payload = JSON.parse(body || "{}");
  const title = /Page title: ([^\\]*)\\n/.exec(JSON.stringify(payload.messages ?? ""))?.[1];
  console.log(`[anthropic] ${request.url} model=${payload.model} title=${title}`);
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
