import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPageFetcher, PageFetchError, type Lookup } from "./page-fetcher.ts";

// What the fake resolver answers. `public.test` claims a public address, but the sockets below go
// to a local server either way: the test is about what the fetcher does with an answer.
const ANSWERS: Record<string, string[]> = {
  "public.test": ["93.184.216.34"],
  "internal.test": ["10.0.0.5"],
  "metadata.test": ["169.254.169.254"],
  "mixed.test": ["93.184.216.34", "127.0.0.1"],
};

const lookup: Lookup = (hostname, _options, callback) => {
  const addresses = ANSWERS[hostname];
  if (!addresses) {
    return callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), []);
  }
  callback(
    null,
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
  );
};

type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void;

/**
 * A page server on loopback, and an agent that sends every `http:` request to it. The agent runs
 * the lookup the fetcher gave the request first, as a real connect would, so a refused address
 * stops the request before any socket opens, and nothing but the destination is faked.
 */
async function startServer(handler: Handler) {
  const requested: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = http.createServer((request, response) => {
    requested.push(request.url ?? "");
    handler(request, response);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  class LoopbackAgent extends http.Agent {
    override createConnection(
      options: http.ClientRequestArgs,
      callback?: (error: Error | null, stream: net.Socket) => void,
    ) {
      const resolve = options.lookup as unknown as (
        hostname: string,
        options: object,
        callback: (error: Error | null, address: string) => void,
      ) => void;
      resolve(String(options.host), {}, (error) => {
        if (error) return callback?.(error, undefined as never);
        callback?.(null, net.connect(port, "127.0.0.1"));
      });
      return undefined;
    }
  }

  return {
    port,
    requested,
    agent: new LoopbackAgent(),
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

type Server = Awaited<ReturnType<typeof startServer>>;

let server: Server | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const html = (response: http.ServerResponse, body: string) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
};

describe("createPageFetcher", () => {
  describe("against a page on a public name", () => {
    beforeEach(async () => {
      server = await startServer((request, response) => {
        if (request.url === "/page") {
          return html(
            response,
            "<html><head><title>Small gardens</title></head><body><p>They reward patience.</p></body></html>",
          );
        }
        if (request.url === "/old") {
          response.writeHead(301, { location: "/page" });
          return response.end();
        }
        response.writeHead(404).end();
      });
    });

    it("reads the title and text of the page", async () => {
      const fetcher = createPageFetcher({ lookup, agent: server!.agent });
      const page = await fetcher.fetchPage(`http://public.test:${server!.port}/page`);
      expect(page.title).toBe("Small gardens");
      expect(page.text).toContain("They reward patience.");
    });

    it("follows a redirect to another page on the same host", async () => {
      const fetcher = createPageFetcher({ lookup, agent: server!.agent });
      const page = await fetcher.fetchPage(`http://public.test:${server!.port}/old`);
      expect(page.title).toBe("Small gardens");
    });

    it("fails with the status when the site answers with an error", async () => {
      const fetcher = createPageFetcher({ lookup, agent: server!.agent });
      await expect(fetcher.fetchPage(`http://public.test:${server!.port}/missing`)).rejects.toThrow(
        "The site answered 404",
      );
    });
  });

  describe("a redirect to a private address", () => {
    it.each([
      ["a loopback address", (port: number) => `http://127.0.0.1:${port}/secret`],
      ["a cloud metadata address", () => "http://169.254.169.254/latest/meta-data/"],
      ["an IPv6 loopback address", (port: number) => `http://[::1]:${port}/secret`],
      [
        "a name that resolves to a private address",
        (port: number) => `http://internal.test:${port}/secret`,
      ],
    ])("is refused when it points at %s", async (_label, target) => {
      server = await startServer((request, response) => {
        if (request.url === "/start") {
          response.writeHead(302, { location: target(server!.port) });
          return response.end();
        }
        html(response, "<html><body>internal secret</body></html>");
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent });

      await expect(fetcher.fetchPage(`http://public.test:${server.port}/start`)).rejects.toThrow(
        PageFetchError,
      );
      // The first hop was fetched; the private target never was.
      expect(server.requested).toEqual(["/start"]);
    });
  });

  describe("a URL with an IP address in it", () => {
    it.each([
      "http://127.0.0.1:{port}/",
      "http://10.0.0.1/",
      "http://192.168.1.1/admin",
      "http://169.254.169.254/latest/meta-data/",
      "http://0.0.0.0/",
      "http://[::1]:{port}/",
      "http://[::ffff:127.0.0.1]:{port}/",
      "http://[fe80::1]/",
    ])("is refused when it is %s", async (template) => {
      server = await startServer((_request, response) => {
        html(response, "<html><body>internal secret</body></html>");
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent });

      await expect(
        fetcher.fetchPage(template.replace("{port}", String(server.port))),
      ).rejects.toThrow("is not a public address");
      expect(server.requested).toEqual([]);
    });

    it("is refused even when the resolver would have said it is fine", async () => {
      server = await startServer((_request, response) => {
        html(response, "<html><body>internal secret</body></html>");
      });
      const fetcher = createPageFetcher({
        lookup: (_hostname, _options, callback) =>
          callback(null, [{ address: "93.184.216.34", family: 4 }]),
        agent: server.agent,
      });

      await expect(fetcher.fetchPage(`http://127.0.0.1:${server.port}/`)).rejects.toThrow(
        "is not a public address",
      );
      expect(server.requested).toEqual([]);
    });
  });

  describe("a host name that resolves to a private address", () => {
    it.each([
      ["a private network address", "internal.test"],
      ["the cloud metadata address", "metadata.test"],
      ["a public address and a loopback one", "mixed.test"],
    ])("is refused at connect time when it resolves to %s", async (_label, host) => {
      server = await startServer((_request, response) => {
        html(response, "<html><body>internal secret</body></html>");
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent });

      await expect(fetcher.fetchPage(`http://${host}:${server.port}/`)).rejects.toThrow(
        `${host} is not a public address`,
      );
      expect(server.requested).toEqual([]);
    });

    it("is checked on every lookup, so a name that changes its answer is caught", async () => {
      server = await startServer((_request, response) => {
        html(response, "<html><head><title>Fine</title></head><body>Hello</body></html>");
      });
      // A first answer that passes, then a rebind to loopback.
      let answers = 0;
      const rebinding: Lookup = (_hostname, _options, callback) => {
        answers += 1;
        callback(null, [{ address: answers === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }]);
      };
      const fetcher = createPageFetcher({ lookup: rebinding, agent: server.agent });
      const url = `http://rebind.test:${server.port}/`;

      await expect(fetcher.fetchPage(url)).resolves.toMatchObject({ title: "Fine" });
      await expect(fetcher.fetchPage(url)).rejects.toThrow("rebind.test is not a public address");
    });

    it("fails when the name doesn't resolve at all", async () => {
      server = await startServer((_request, response) => response.end());
      const fetcher = createPageFetcher({ lookup, agent: server.agent });

      await expect(fetcher.fetchPage(`http://unknown.test:${server.port}/`)).rejects.toThrow(
        "ENOTFOUND",
      );
    });
  });

  it("refuses an address that isn't a web address", async () => {
    const fetcher = createPageFetcher({ lookup });
    await expect(fetcher.fetchPage("ftp://public.test/file")).rejects.toThrow("Not a web address");
  });

  describe("the size cap", () => {
    it("stops reading a body that goes past it, and still returns what it read", async () => {
      let closedByReader = false;
      let sent = 0;
      server = await startServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/html" });
        response.write("<html><head><title>Endless</title></head><body><p>");
        const chunk = "word ".repeat(13_000); // about 64 KB
        const writeMore = () => {
          while (!response.destroyed && !response.writableEnded && sent < 200_000_000) {
            sent += chunk.length;
            if (!response.write(chunk)) return void response.once("drain", writeMore);
          }
        };
        response.on("close", () => {
          closedByReader = !response.writableFinished;
        });
        writeMore();
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent, maxBytes: 10_000 });

      const page = await fetcher.fetchPage(`http://public.test:${server.port}/`);

      expect(page.title).toBe("Endless");
      expect(page.text).toContain("word");
      // The reader hung up long before the server had sent what it had.
      await expect.poll(() => closedByReader).toBe(true);
      expect(sent).toBeLessThan(100_000_000);
    });
  });

  describe("checkLink", () => {
    const url = (path = "/") => `http://public.test:${server!.port}${path}`;

    it("finds a page that answers 200 alive, following a redirect to it", async () => {
      server = await startServer((request, response) => {
        if (request.url === "/old") {
          response.writeHead(301, { location: "/page" });
          return response.end();
        }
        html(response, "<html><body>Hello</body></html>");
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent });

      expect(await fetcher.checkLink(url("/page"))).toBe("alive");
      expect(await fetcher.checkLink(url("/old"))).toBe("alive");
    });

    it("finds a page alive whatever it is: a PDF is a link that works", async () => {
      server = await startServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/pdf" });
        response.end("%PDF-1.7");
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent });

      expect(await fetcher.checkLink(url())).toBe("alive");
    });

    it.each([404, 410, 500, 503])("finds a page that answers %i dead", async (status) => {
      server = await startServer((_request, response) => response.writeHead(status).end());
      const fetcher = createPageFetcher({ lookup, agent: server.agent });

      expect(await fetcher.checkLink(url())).toBe("dead");
    });

    it.each([401, 403, 406, 429])(
      "can't tell when the site answers %i: it is there and won't say more",
      async (status) => {
        server = await startServer((_request, response) => response.writeHead(status).end());
        const fetcher = createPageFetcher({ lookup, agent: server.agent });

        expect(await fetcher.checkLink(url())).toBe("unknown");
      },
    );

    it("finds a page behind a redirect to a bot wall unknown", async () => {
      server = await startServer((request, response) => {
        if (request.url === "/start") {
          response.writeHead(302, { location: "/wall" });
        } else {
          response.writeHead(403);
        }
        response.end();
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent });

      expect(await fetcher.checkLink(url("/start"))).toBe("unknown");
    });

    it("accepts any kind of file, so a server isn't tempted to answer 406", async () => {
      let accept: string | undefined;
      server = await startServer((request, response) => {
        accept = request.headers.accept;
        response.writeHead(200).end();
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent });

      await fetcher.checkLink(url());

      expect(accept).toBe("*/*");
    });

    it("finds a redirect to a missing page dead, and a redirect loop dead", async () => {
      server = await startServer((request, response) => {
        if (request.url === "/gone") {
          response.writeHead(302, { location: "/missing" });
        } else if (request.url === "/loop") {
          response.writeHead(302, { location: "/loop" });
        } else {
          response.writeHead(404);
        }
        response.end();
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent });

      expect(await fetcher.checkLink(url("/gone"))).toBe("dead");
      expect(await fetcher.checkLink(url("/loop"))).toBe("dead");
    });

    it("finds a name that doesn't resolve dead, and one that is not a web address", async () => {
      server = await startServer((_request, response) => response.end());
      const fetcher = createPageFetcher({ lookup, agent: server.agent });

      expect(await fetcher.checkLink(`http://unknown.test:${server.port}/`)).toBe("dead");
      expect(await fetcher.checkLink("ftp://public.test/file")).toBe("dead");
    });

    it("finds a refused connection dead", async () => {
      server = await startServer((_request, response) => response.end());
      const { port } = server;
      const fetcher = createPageFetcher({ lookup, agent: server.agent });
      await server.close();
      server = undefined;

      expect(await fetcher.checkLink(`http://public.test:${port}/`)).toBe("dead");
    });

    it("never reaches an internal address, and says dead", async () => {
      server = await startServer((request, response) => {
        if (request.url === "/start") {
          response.writeHead(302, { location: `http://127.0.0.1:${server!.port}/secret` });
          return response.end();
        }
        html(response, "internal secret");
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent });

      expect(await fetcher.checkLink(url("/start"))).toBe("dead");
      expect(await fetcher.checkLink(`http://internal.test:${server.port}/`)).toBe("dead");
      expect(await fetcher.checkLink(`http://127.0.0.1:${server.port}/`)).toBe("dead");
      expect(server.requested).toEqual(["/start"]);
    });

    it("gives up on a site that never answers", async () => {
      server = await startServer(() => {
        // Accepts the request and says nothing.
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent, checkBudgetMs: 200 });

      expect(await fetcher.checkLink(url())).toBe("dead");
    });

    it("hangs up after the first bytes of a long body", async () => {
      let closedByReader = false;
      let sent = 0;
      server = await startServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/html" });
        const chunk = "word ".repeat(13_000); // about 64 KB
        const writeMore = () => {
          while (!response.destroyed && !response.writableEnded && sent < 200_000_000) {
            sent += chunk.length;
            if (!response.write(chunk)) return void response.once("drain", writeMore);
          }
        };
        response.on("close", () => {
          closedByReader = !response.writableFinished;
        });
        writeMore();
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent });

      expect(await fetcher.checkLink(url())).toBe("alive");
      await expect.poll(() => closedByReader).toBe(true);
      expect(sent).toBeLessThan(10_000_000);
    });
  });

  describe("the time budget", () => {
    it("gives up on a site that never answers", async () => {
      server = await startServer(() => {
        // Accepts the request and says nothing.
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent, budgetMs: 200 });

      await expect(fetcher.fetchPage(`http://public.test:${server.port}/`)).rejects.toMatchObject({
        name: expect.stringMatching(/Abort|Timeout/),
      });
    });

    it("gives up on a body that trickles in without end", async () => {
      server = await startServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/html" });
        const timer = setInterval(() => response.write("x"), 20);
        response.on("close", () => clearInterval(timer));
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent, budgetMs: 300 });

      await expect(fetcher.fetchPage(`http://public.test:${server.port}/`)).rejects.toMatchObject({
        name: expect.stringMatching(/Abort|Timeout/),
      });
    });

    it("counts the whole fetch, redirects included, against one budget", async () => {
      server = await startServer((request, response) => {
        if (request.url === "/slow") return; // never answers
        response.writeHead(302, { location: "/slow" });
        response.end();
      });
      const fetcher = createPageFetcher({ lookup, agent: server.agent, budgetMs: 300 });

      await expect(fetcher.fetchPage(`http://public.test:${server.port}/`)).rejects.toMatchObject({
        name: expect.stringMatching(/Abort|Timeout/),
      });
      expect(server.requested).toEqual(["/", "/slow"]);
    });
  });
});
