import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Deliberately duplicated from @alignment/core's own pi-agent-dir.ts
 * (same two functions, same behavior, its own test suite there) rather than
 * imported: this file is reachable from vite.config.ts's own module graph
 * (via process-rpc-session.ts), and vite.config.ts is loaded by Vite's
 * config loader using plain Node ESM resolution -- confirmed live, this
 * breaks outright (`ERR_MODULE_NOT_FOUND ... command/dispatcher.js`) the
 * moment anything in that graph imports @alignment/core, a TS-source-only
 * workspace package with no build step (its own internal relative imports
 * use `.js` specifiers that only resolve through a TypeScript-aware
 * bundler/transform, which every other real consumer gets via Vite's
 * app/test transform pipeline -- vite.config.ts's own config-loading step
 * is the one path in this app that never does). Keep both copies in sync by
 * hand if the isolation strategy ever changes; small and pure enough that
 * the duplication cost is low compared to re-breaking every apps/alignment
 * test via vite.config.ts failing to load at all.
 */
export function resolveAlignmentAgentDir(env: Record<string, string | undefined> = process.env): string {
	const override = env.ALIGNMENT_PI_AGENT_DIR;
	if (override) return override;
	return join(homedir(), ".alignment", "pi-agent");
}

export interface SeedAlignmentAuthOptions {
	readonly agentDir: string;
	readonly sourceAgentDir: string;
}

/** See @alignment/core's seedAlignmentAuthOnce for the full doc comment -- identical behavior. */
export function seedAlignmentAuthOnce(options: SeedAlignmentAuthOptions): void {
	const destAuthPath = join(options.agentDir, "auth.json");
	if (existsSync(destAuthPath)) return;
	const sourceAuthPath = join(options.sourceAgentDir, "auth.json");
	if (!existsSync(sourceAuthPath)) return;
	mkdirSync(options.agentDir, { recursive: true });
	copyFileSync(sourceAuthPath, destAuthPath);
}
