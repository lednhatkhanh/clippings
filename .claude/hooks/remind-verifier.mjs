// PostToolUse hook: after the main session's first edit in apps/web or packages/db, remind it to
// hand runtime verification to the `verifier` agent. Once per session per area, so the reminder
// costs a few tokens rather than one per edit. Edits made inside a sub-agent are skipped: the
// implementer reports them back and the main session verifies.

import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const areas = { "apps/web/": "web", "packages/db/": "db" };

let input = "";
for await (const chunk of process.stdin) input += chunk;
const event = JSON.parse(input);
if (event.agent_id) process.exit(0);

const file = event.tool_response?.filePath ?? event.tool_input?.file_path;
if (!file) process.exit(0);
const path = relative(process.env.CLAUDE_PROJECT_DIR ?? event.cwd, file);
const prefix = Object.keys(areas).find((p) => path.startsWith(p));
if (!prefix) process.exit(0);

const marker = join(tmpdir(), `clippings-verifier-${event.session_id}-${areas[prefix]}`);
if (existsSync(marker)) process.exit(0);
writeFileSync(marker, "");

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `You edited ${prefix}. Before reporting this work done, launch the \`verifier\` agent with the pages, routes or queries to exercise, and relay what it saw.`,
    },
  }),
);
