import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Zodiac's own Pi config/extension/session/auth namespace -- deliberately
 * separate from `~/.pi/agent` (the user's *personal* Pi CLI's own directory).
 * Passing this as `agentDir` to @earendil-works/pi-coding-agent's
 * createAgentSession() (in-process path) or as PI_CODING_AGENT_DIR
 * (subprocess `pi --mode rpc` path -- confirmed live: pi's own config.ts
 * reads process.env[ENV_AGENT_DIR] per call, not cached at import) means
 * Zodiac's embedded chat never sees the user's personally-installed Pi
 * extensions (pipes/tickets/web-spider/...), their session history, or
 * their settings.json -- only whatever is explicitly provisioned into this
 * directory. Overridable via ZODIAC_PI_AGENT_DIR, mirroring pi's own
 * PI_CODING_AGENT_DIR override convention (tests/advanced setups).
 */
export function resolveZodiacAgentDir(env: Record<string, string | undefined> = process.env): string {
	const override = env.ZODIAC_PI_AGENT_DIR;
	if (override) return override;
	return join(homedir(), ".zodiac", "pi-agent");
}

export interface SeedZodiacAuthOptions {
	/** Zodiac's own namespaced agent dir -- the copy destination. */
	readonly agentDir: string;
	/** The user's personal Pi agent dir to seed credentials from -- typically ~/.pi/agent. */
	readonly sourceAgentDir: string;
}

/**
 * One-time credential bootstrap: the first time Zodiac's own agent
 * directory has no auth.json yet, copy the user's existing
 * <sourceAgentDir>/auth.json so Zodiac's first real run doesn't silently
 * lose access to already-configured model credentials just because its own
 * agent dir is otherwise fully isolated. Deliberately narrow -- copies
 * auth.json only, never settings.json/extensions/npm/sessions -- and never
 * overwrites an auth.json that already exists at the destination (a later,
 * deliberately different Zodiac-side auth is never clobbered by this).
 * Safe to call unconditionally on every startup: it is a no-op once seeded,
 * and a no-op (not a throw) when there is nothing to copy yet.
 */
export function seedZodiacAuthOnce(options: SeedZodiacAuthOptions): void {
	const destAuthPath = join(options.agentDir, "auth.json");
	if (existsSync(destAuthPath)) return;
	const sourceAuthPath = join(options.sourceAgentDir, "auth.json");
	if (!existsSync(sourceAuthPath)) return;
	mkdirSync(options.agentDir, { recursive: true });
	copyFileSync(sourceAuthPath, destAuthPath);
}
