// Runs the CI task set, affected-only where that is safe.
//
// `turbo --affected` selects packages from changed files, and a change to a
// root-level file (lint or format config, assertion scripts, lockfile, toolchain
// pins, workflows) selects nothing even though it can change every result. For
// those changes, or whenever the base commit can't be determined, run everything.

import { execFileSync, spawnSync } from "node:child_process";

const tasks = ["lint", "format:check", "typecheck", "test", "build"];
const rootConfig =
  /^(\.oxlintrc\.json|\.oxfmtrc\.json|\.node-version|turbo\.json|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|scripts\/|\.github\/)/;

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const baseCommit = () => {
  const { GITHUB_EVENT_NAME, GITHUB_BASE_REF, BEFORE_SHA } = process.env;
  if (GITHUB_EVENT_NAME === "pull_request" && GITHUB_BASE_REF) {
    return git("merge-base", "HEAD", `origin/${GITHUB_BASE_REF}`);
  }
  if (BEFORE_SHA && !/^0+$/.test(BEFORE_SHA)) return BEFORE_SHA;
  return null;
};

const decide = () => {
  try {
    const base = baseCommit();
    if (base === null) return { affected: false, reason: "no base commit to compare against" };
    const changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
    const root = changed.find((file) => rootConfig.test(file));
    if (root) return { affected: false, reason: `root file changed: ${root}` };
    return { affected: true, reason: `${changed.length} changed file(s), none at the root` };
  } catch (error) {
    return { affected: false, reason: `could not diff (${error.message.split("\n")[0]})` };
  }
};

const { affected, reason } = decide();
console.log(affected ? `▶ affected-only run: ${reason}` : `▶ full run: ${reason}`);

const result = spawnSync("pnpm", ["turbo", "run", ...tasks, ...(affected ? ["--affected"] : [])], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
