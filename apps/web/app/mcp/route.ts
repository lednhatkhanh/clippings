import { getAuth } from "@/lib/auth/auth.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import { createMcpRoute } from "@/lib/mcp/handler.ts";
import { mcpResourceUrl } from "@/lib/mcp/resource.ts";

let handler: ((request: Request) => Promise<Response>) | undefined;

/** The MCP endpoint (see `createMcpRoute`). Built on first use, so `next build` needs no secrets. */
function getHandler() {
  return (handler ??= createMcpRoute({
    auth: getAuth(),
    clippings: getClippings(),
    resource: mcpResourceUrl(),
    allowedEmails: process.env.ALLOWED_EMAILS,
  }));
}

export function POST(request: Request) {
  return getHandler()(request);
}

// Stateless: there is no stream to open or session to end, so these answer 405 once
// authenticated. They still challenge first, like every MCP request.
export function GET(request: Request) {
  return getHandler()(request);
}

export function DELETE(request: Request) {
  return getHandler()(request);
}
