// Fails when src/schema.ts has changes that no migration in ./drizzle covers.
//
//   tsx scripts/check-schema.ts
//
// Runs `drizzle-kit generate` against a copy of the migrations folder and fails when it would
// write a new migration. Nothing in the real folder is touched.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), "clippings-schema-check-"));
const out = join(scratch, "drizzle");

try {
  cpSync(join(root, "drizzle"), out, { recursive: true });
  const before = readdirSync(out).length;

  const config = join(scratch, "drizzle.config.mjs");
  writeFileSync(
    config,
    `export default ${JSON.stringify({ dialect: "postgresql", schema: join(root, "src", "schema.ts"), out })};`,
  );
  execFileSync("pnpm", ["exec", "drizzle-kit", "generate", `--config=${config}`, "--name=check"], {
    cwd: root,
    stdio: "pipe",
  });

  if (readdirSync(out).length !== before) {
    console.error(
      "src/schema.ts has changes without a migration.\n" +
        "Run `pnpm --filter @clippings/db generate`, review the SQL (expand/contract), and commit it.",
    );
    process.exitCode = 1;
  } else {
    console.log("Schema and migrations agree.");
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
