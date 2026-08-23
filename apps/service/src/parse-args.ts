export interface ZodiacdArgs {
	port: number;
	host: string;
	sessionsRoot: string | undefined;
	stateDir: string | undefined;
	/** Serve deterministic, filesystem-free fixture conversations instead of scanning sessionsRoot -- for Playwright's system suite, never a real deployment. */
	fixtureMode: boolean;
	/** Wires the terminal-session routes (a real shell over WebSocket) -- off by default: real RCE exposure once the daemon is reachable off loopback, and there is no auth yet (see the "zodiacd API surface" Papyrus Doc's Terminal sessions section). */
	enableTerminal: boolean;
	/** Explicit package.json files only; bounded and resolved by the Integration loader. */
	integrationPackageJsonPaths: readonly string[];
	/** Exact browser Origin values this daemon answers -- see server.ts's own CreateZodiacServiceOptions.allowedOrigins doc comment. */
	allowedOrigins: readonly string[];
}

export const DEFAULT_PORT = 4390;
export const DEFAULT_HOST = "127.0.0.1";
// apps/web's own fixed, --strictPort dev server (scripts/check-dev-port.mjs)
// -- the one real, statically-known Web origin this daemon serves out of the
// box. A packaged production deployment (a static host serving apps/web's
// dist/, or a future Electron custom-protocol origin) is not knowable here
// and must be configured explicitly via --allowed-origin/ZODIAC_ALLOWED_ORIGINS.
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = ["http://127.0.0.1:5173", "http://localhost:5173"];

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
	let allowedOrigins: string[] = env.ZODIAC_ALLOWED_ORIGINS !== undefined ? env.ZODIAC_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter((value) => value.length > 0) : [...DEFAULT_ALLOWED_ORIGINS];
	let integrationPackageJsonPaths: string[] = [];
	if (env.ZODIAC_INTEGRATION_PACKAGES !== undefined) {
		let configured: unknown;
		try {
			configured = JSON.parse(env.ZODIAC_INTEGRATION_PACKAGES) as unknown;
		} catch {
			throw new Error("zodiacd: ZODIAC_INTEGRATION_PACKAGES must be a JSON array of package.json paths");
		}
		if (!Array.isArray(configured) || configured.some((entry) => typeof entry !== "string" || entry.length === 0)) {
			throw new Error("zodiacd: ZODIAC_INTEGRATION_PACKAGES must be a JSON array of package.json paths");
		}
		integrationPackageJsonPaths = configured;
	}

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--port") port = Number(argv[++i]);
		else if (arg === "--host") host = argv[++i] ?? host;
		else if (arg === "--sessions-root") sessionsRoot = argv[++i];
		else if (arg === "--state-dir") stateDir = argv[++i];
		else if (arg === "--fixture-mode") fixtureMode = true;
		else if (arg === "--enable-terminal") enableTerminal = true;
		else if (arg === "--allowed-origin") {
			const value = argv[++i];
			if (!value) throw new Error("zodiacd: --allowed-origin requires an origin, e.g. http://127.0.0.1:5173");
			allowedOrigins.push(value);
		} else if (arg === "--integration-package") {
			const path = argv[++i];
			if (!path) throw new Error("zodiacd: --integration-package requires a package.json path");
			integrationPackageJsonPaths.push(path);
		}
	}

	if (!Number.isInteger(port) || port < 0) throw new Error(`zodiacd: invalid --port "${port}"`);

	return { port, host, sessionsRoot, stateDir, fixtureMode, enableTerminal, allowedOrigins, integrationPackageJsonPaths };
}
