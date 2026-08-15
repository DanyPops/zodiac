import { describe, expect, it } from "vitest";
import { DEFAULT_HOST, DEFAULT_PORT, parseZodiacdArgs } from "./parse-args.js";

describe("parseZodiacdArgs", () => {
	it("defaults to DEFAULT_PORT/DEFAULT_HOST with no args or env, fixtureMode/enableTerminal false", () => {
		const args = parseZodiacdArgs([], {});
		expect(args).toEqual({ port: DEFAULT_PORT, host: DEFAULT_HOST, sessionsRoot: undefined, stateDir: undefined, fixtureMode: false, enableTerminal: false });
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

	it("rejects a non-numeric or negative --port", () => {
		expect(() => parseZodiacdArgs(["--port", "not-a-number"])).toThrow(/invalid --port/);
		expect(() => parseZodiacdArgs(["--port", "-1"])).toThrow(/invalid --port/);
	});
});
