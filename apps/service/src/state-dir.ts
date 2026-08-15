import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where zodiacd persists its own state (the World snapshot today; a daemon
 * registry entry once stage 5 needs one) -- separate from ~/.zodiac/pi-agent
 * (the embedded Pi chat's own namespace, see @zodiac/server/pi-agent-dir).
 * Overridable via ZODIAC_SERVICE_STATE_DIR for tests and advanced setups.
 */
export function resolveZodiacServiceStateDir(env: Record<string, string | undefined> = process.env): string {
	return env.ZODIAC_SERVICE_STATE_DIR ?? join(homedir(), ".zodiac", "service");
}
