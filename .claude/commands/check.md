---
description: Run the same checks CI runs and report what fails
allowed-tools: Bash(pnpm format), Bash(pnpm check:root), Bash(node scripts/run-checks.mjs)
---

Run these in order and stop at the first failure:

1. `pnpm format`
2. `pnpm check:root`
3. `node scripts/run-checks.mjs`

If a step fails, name the failing task and package, show the relevant error lines, and fix the cause. Re-run only the failing step until it passes, then run the whole list once more. Report green only when all three pass in the same pass.
