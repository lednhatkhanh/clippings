---
description: Run the same checks CI runs and fix what fails
allowed-tools: Agent(checker), Bash(pnpm format), Bash(pnpm check:root), Bash(node scripts/run-checks.mjs), Bash(pnpm turbo run *)
---

1. Launch the `checker` agent in the foreground. It runs the CI checks and answers `GREEN`, or
   `RED` with the failing task, package and error lines.
2. On `RED`, fix the cause in this session. To confirm a fix, re-run only the failing task
   yourself (`pnpm turbo run <task> --filter <package>`), then go back to step 1.

Done when `checker` answers `GREEN` after your last edit. Report what failed and what you changed.
