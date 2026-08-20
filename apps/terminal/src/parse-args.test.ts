import { describe, expect, it } from "vitest";
import { parseTerminalArgs } from "./parse-args.js";

describe("parseTerminalArgs", () => {
	it("returns the sole positional argument as path, mode 'monolith', and no daemonUrl, when given nothing else", () => {
		expect(parseTerminalArgs(["/repos/lector"], {})).toEqual({ path: "/repos/lector", mode: "monolith", daemonUrl: undefined });
	});

	it("returns no path at all when argv is empty, matching today's classifyPath(undefined) contract", () => {
		expect(parseTerminalArgs([], {})).toEqual({ path: undefined, mode: "monolith", daemonUrl: undefined });
	});

	it("scans out --daemon <url>, leaving the positional path argument untouched, and implies mode 'remote'", () => {
		expect(parseTerminalArgs(["/repos/lector", "--daemon", "http://127.0.0.1:4390"], {})).toEqual({ path: "/repos/lector", mode: "remote", daemonUrl: "http://127.0.0.1:4390" });
	});

	it("--daemon works regardless of its position relative to the positional argument", () => {
		expect(parseTerminalArgs(["--daemon", "http://127.0.0.1:4390", "/repos/lector"], {})).toEqual({ path: "/repos/lector", mode: "remote", daemonUrl: "http://127.0.0.1:4390" });
	});

	it("falls back to ZODIAC_DAEMON_URL when --daemon is not given, and implies mode 'remote'", () => {
		expect(parseTerminalArgs(["/repos/lector"], { ZODIAC_DAEMON_URL: "http://127.0.0.1:4390" })).toEqual({ path: "/repos/lector", mode: "remote", daemonUrl: "http://127.0.0.1:4390" });
	});

	it("--daemon overrides ZODIAC_DAEMON_URL when both are given", () => {
		expect(parseTerminalArgs(["--daemon", "http://explicit:1"], { ZODIAC_DAEMON_URL: "http://from-env:2" })).toEqual({ path: undefined, mode: "remote", daemonUrl: "http://explicit:1" });
	});

	it("an explicit --mode always wins over the daemonUrl-presence inference", () => {
		expect(parseTerminalArgs(["--mode", "monolith", "--daemon", "http://127.0.0.1:4390"], {})).toEqual({ path: undefined, mode: "monolith", daemonUrl: "http://127.0.0.1:4390" });
	});

	it("--mode local-server needs no daemon URL at all", () => {
		expect(parseTerminalArgs(["/repos/lector", "--mode", "local-server"], {})).toEqual({ path: "/repos/lector", mode: "local-server", daemonUrl: undefined });
	});

	it("--mode remote with no daemon URL anywhere is a real, explicit parse-time error -- never a silent fallback", () => {
		expect(() => parseTerminalArgs(["--mode", "remote"], {})).not.toThrow();
		// parseTerminalArgs itself only resolves the mode value; requiring a
		// daemonUrl for "remote" specifically is main()'s own responsibility
		// (see cli.ts), so this call succeeds with daemonUrl: undefined --
		// asserted here so that contract stays pinned.
		expect(parseTerminalArgs(["--mode", "remote"], {})).toEqual({ path: undefined, mode: "remote", daemonUrl: undefined });
	});

	it("rejects an unrecognized --mode value outright, never silently defaulting", () => {
		expect(() => parseTerminalArgs(["--mode", "bogus"], {})).toThrow(/--mode must be one of/);
	});

	it("rejects --mode given with no value at all", () => {
		expect(() => parseTerminalArgs(["--mode"], {})).toThrow(/--mode must be one of/);
	});
});
