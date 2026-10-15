# Run our own OAuth authorization server inside the app

claude.ai custom connectors and Claude Code need an OAuth authorization server with client metadata documents or dynamic registration, and Google sign-in offers neither. We run Better Auth's `mcp()` plugin in the Next.js app as that server, with Google as the only way to prove identity, and the same server issues tokens to the extension.

Without this the MCP endpoint cannot be added to Claude at all, and replacing it later means every connected client re-authorizes.
