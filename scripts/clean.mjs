#!/usr/bin/env node
/**
 * Removes every workspace's own build/test output and lint cache -- exactly
 * the set .gitignore already excludes for that reason (dist/, test-results/,
 * playwright-report/, .eslintcache) -- without touching node_modules or
 * package-lock.json. A plain `rm -rf` glob can't safely express "every
 * workspace, but never node_modules" in one line without `-not -path`
 * juggling; this is that logic in one place, reused by both `npm run clean`
 * and (implicitly, since it's a no-op if already clean) anyone re-running it
 * mid-troubleshoot.
 *
 * For the "something's actually broken, nuke node_modules too" case, see
 * `npm run reinstall` instead -- deliberately a separate, slower, explicit
 * command rather than folded into this one, since a plain "clean my build
 * output" run should never also cost you a multi-second reinstall.
 */
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TARGET_DIR_NAMES = ["dist", "test-results", "playwright-report"];
const TARGET_FILE_NAMES = [".eslintcache"];
const WORKSPACE_ROOTS = ["apps/web", "apps/terminal", "apps/service", "packages/agent", "packages/pi", "packages/protocol", "packages/server", "prototypes/ui-compat-lab"];

let removedCount = 0;

for (const workspaceRoot of WORKSPACE_ROOTS) {
	for (const name of TARGET_DIR_NAMES) removeIfPresent(join(repoRoot, workspaceRoot, name));
	for (const name of TARGET_FILE_NAMES) removeIfPresent(join(repoRoot, workspaceRoot, name));
}

function removeIfPresent(path) {
	if (!existsSync(path)) return;
	try {
		rmSync(path, { recursive: true, force: true });
		removedCount += 1;
		console.log(`removed ${path}`);
	} catch (error) {
		console.error(`failed to remove ${path}: ${error.message}`);
		process.exitCode = 1;
	}
}

console.log(removedCount > 0 ? `clean: removed ${removedCount} path(s) (already-clean ones are silently skipped).` : "clean: nothing to remove.");
