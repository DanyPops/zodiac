export interface ZodiacdArgs {
	port: number;
	host: string;
	sessionsRoot: string | undefined;
	stateDir: string | undefined;
	/** Serve deterministic, filesystem-free fixture conversations instead of scanning sessionsRoot -- for Playwright's system suite, never a real deployment. */
	fixtureMode: boolean;
	/** Wires the terminal-session routes (a real shell over WebSocket) -- off by default: real RCE exposure once the daemon is reachable off loopback, and there is no auth yet (see the "zodiacd API surface" Papyrus Doc's Terminal sessions section). */
	enableTerminal: boolean;
}

export const DEFAULT_PORT = 4390;
export const DEFAULT_HOST = "127.0.0.1";

/**
 * Minimal, dependency-free CLI arg parsing for zodiacd -- --port/--host
 * override the environment, which overrides the hardcoded default, matching
 * the layering apps/web's own dev port check already uses. --sessions-root
 * and --state-dir are injection points for tests and advanced setups, left
 * undefined (letting the caller apply its own default) when not given.
 */
export function parseZodiacdArgs(argv: readonly string[], env: Record<string, string | undefined> = process.env): ZodiacdArgs {
	let port = env.ZODIAC_SERVICE_PORT ? Number(env.ZODIAC_SERVICE_PORT) : DEFAULT_PORT;
	let host = env.ZODIAC_SERVICE_HOST ?? DEFAULT_HOST;
	let sessionsRoot: string | undefined;
	let stateDir: string | undefined;
	let fixtureMode = env.ZODIAC_FIXTURE_MODE === "1";
	let enableTerminal = env.ZODIAC_ENABLE_TERMINAL === "1";

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--port") port = Number(argv[++i]);
		else if (arg === "--host") host = argv[++i] ?? host;
		else if (arg === "--sessions-root") sessionsRoot = argv[++i];
		else if (arg === "--state-dir") stateDir = argv[++i];
		else if (arg === "--fixture-mode") fixtureMode = true;
		else if (arg === "--enable-terminal") enableTerminal = true;
	}

	if (!Number.isInteger(port) || port < 0) throw new Error(`zodiacd: invalid --port "${port}"`);

	return { port, host, sessionsRoot, stateDir, fixtureMode, enableTerminal };
}
