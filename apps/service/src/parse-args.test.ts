import { describe, expect, it } from "vitest";
import { DEFAULT_ALLOWED_ORIGINS, DEFAULT_HOST, DEFAULT_PORT, parseZodiacdArgs } from "./parse-args.js";

describe("parseZodiacdArgs", () => {
	it("defaults to DEFAULT_PORT/DEFAULT_HOST with no args or env, fixtureMode/enableTerminal false", () => {
		const args = parseZodiacdArgs([], {});
		expect(args).toEqual({ port: DEFAULT_PORT, host: DEFAULT_HOST, sessionsRoot: undefined, stateDir: undefined, fixtureMode: false, enableTerminal: false, allowedOrigins: DEFAULT_ALLOWED_ORIGINS, integrationPackageJsonPaths: [], hotReloadPollMs: undefined });
	});

	it("hot-reload polling is opt-in and undefined (disabled) by default -- ZODIAC_HOT_RELOAD_POLL_MS or --hot-reload-poll-ms enables it, bounded to a positive integer", () => {
		expect(parseZodiacdArgs([]).hotReloadPollMs).toBeUndefined();
		expect(parseZodiacdArgs([], { ZODIAC_HOT_RELOAD_POLL_MS: "2000" }).hotReloadPollMs).toBe(2000);
		expect(parseZodiacdArgs(["--hot-reload-poll-ms", "500"]).hotReloadPollMs).toBe(500);
		expect(() => parseZodiacdArgs(["--hot-reload-poll-ms", "0"])).toThrow(/hot-reload-poll-ms/);
		expect(() => parseZodiacdArgs(["--hot-reload-poll-ms", "not-a-number"])).toThrow(/hot-reload-poll-ms/);
	});

	it("defaults allowedOrigins to apps/web's own fixed dev port, overridable via ZODIAC_ALLOWED_ORIGINS or repeated --allowed-origin flags", () => {
		expect(parseZodiacdArgs([], { ZODIAC_ALLOWED_ORIGINS: "https://a.example, https://b.example" }).allowedOrigins).toEqual(["https://a.example", "https://b.example"]);
		expect(parseZodiacdArgs(["--allowed-origin", "https://c.example", "--allowed-origin", "https://d.example"], {}).allowedOrigins).toEqual([...DEFAULT_ALLOWED_ORIGINS, "https://c.example", "https://d.example"]);
		expect(() => parseZodiacdArgs(["--allowed-origin"], {})).toThrow(/allowed-origin/);
	});

	it("ZODIAC_ENABLE_TERMINAL=1 or --enable-terminal enables enableTerminal -- off by default, real RCE exposure once reachable off loopback", () => {
		expect(parseZodiacdArgs([], { ZODIAC_ENABLE_TERMINAL: "1" }).enableTerminal).toBe(true);
		expect(parseZodiacdArgs(["--enable-terminal"]).enableTerminal).toBe(true);
		expect(parseZodiacdArgs([]).enableTerminal).toBe(false);
	});

	it("ZODIAC_FIXTURE_MODE=1 or --fixture-mode enables fixtureMode", () => {
		expect(parseZodiacdArgs([], { ZODIAC_FIXTURE_MODE: "1" }).fixtureMode).toBe(true);
		expect(parseZodiacdArgs(["--fixture-mode"]).fixtureMode).toBe(true);
		expect(parseZodiacdArgs([]).fixtureMode).toBe(false);
	});

	it("env vars override the hardcoded defaults", () => {
		const args = parseZodiacdArgs([], { ZODIAC_SERVICE_PORT: "9000", ZODIAC_SERVICE_HOST: "0.0.0.0" });
		expect(args.port).toBe(9000);
		expect(args.host).toBe("0.0.0.0");
	});

	it("--port/--host flags override env", () => {
		const args = parseZodiacdArgs(["--port", "9100", "--host", "10.0.0.1"], { ZODIAC_SERVICE_PORT: "9000", ZODIAC_SERVICE_HOST: "0.0.0.0" });
		expect(args.port).toBe(9100);
		expect(args.host).toBe("10.0.0.1");
	});

	it("--sessions-root and --state-dir are undefined unless explicitly passed", () => {
		expect(parseZodiacdArgs([]).sessionsRoot).toBeUndefined();
		expect(parseZodiacdArgs([]).stateDir).toBeUndefined();
		const args = parseZodiacdArgs(["--sessions-root", "/tmp/sessions", "--state-dir", "/tmp/state"]);
		expect(args.sessionsRoot).toBe("/tmp/sessions");
		expect(args.stateDir).toBe("/tmp/state");
	});

	it("accepts only explicitly configured Integration package.json paths from repeated flags or a JSON env array", () => {
		expect(parseZodiacdArgs(["--integration-package", "/a/package.json", "--integration-package", "/b/package.json"], {}).integrationPackageJsonPaths).toEqual(["/a/package.json", "/b/package.json"]);
		expect(parseZodiacdArgs([], { ZODIAC_INTEGRATION_PACKAGES: JSON.stringify(["/c/package.json"]) }).integrationPackageJsonPaths).toEqual(["/c/package.json"]);
		expect(() => parseZodiacdArgs([], { ZODIAC_INTEGRATION_PACKAGES: "not-json" })).toThrow(/ZODIAC_INTEGRATION_PACKAGES/);
		expect(() => parseZodiacdArgs([], { ZODIAC_INTEGRATION_PACKAGES: JSON.stringify([42]) })).toThrow(/ZODIAC_INTEGRATION_PACKAGES/);
		expect(() => parseZodiacdArgs(["--integration-package"], {})).toThrow(/integration-package/);
	});

	it("rejects a non-numeric or negative --port", () => {
		expect(() => parseZodiacdArgs(["--port", "not-a-number"])).toThrow(/invalid --port/);
		expect(() => parseZodiacdArgs(["--port", "-1"])).toThrow(/invalid --port/);
	});
});
