import { getAuth } from "@/lib/auth/auth.ts";
import { getConnections } from "@/lib/auth/connections.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import { getLibrarian, getLibrarianRunner } from "@/lib/librarian/service.ts";
import { createMcpRoute } from "@/lib/mcp/handler.ts";
import { mcpResourceUrl } from "@/lib/mcp/resource.ts";

// `run_librarian` plans the whole library with a model, which takes minutes on a large one.
export const maxDuration = 300;

let handler: ((request: Request) => Promise<Response>) | undefined;

/** The MCP endpoint (see `createMcpRoute`). Built on first use, so `next build` needs no secrets. */
function getHandler() {
  return (handler ??= createMcpRoute({
    auth: getAuth(),
    clippings: getClippings(),
    librarian: getLibrarian(),
    runner: getLibrarianRunner(),
    connections: getConnections(),
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
