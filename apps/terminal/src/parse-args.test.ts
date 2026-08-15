import { describe, expect, it } from "vitest";
import { parseTerminalArgs } from "./parse-args.js";

describe("parseTerminalArgs", () => {
	it("returns the sole positional argument as path, and no daemonUrl, when given nothing else", () => {
		expect(parseTerminalArgs(["/repos/lector"], {})).toEqual({ path: "/repos/lector", daemonUrl: undefined });
	});

	it("returns no path at all when argv is empty, matching today's classifyPath(undefined) contract", () => {
		expect(parseTerminalArgs([], {})).toEqual({ path: undefined, daemonUrl: undefined });
	});

	it("scans out --daemon <url>, leaving the positional path argument untouched", () => {
		expect(parseTerminalArgs(["/repos/lector", "--daemon", "http://127.0.0.1:4390"], {})).toEqual({ path: "/repos/lector", daemonUrl: "http://127.0.0.1:4390" });
	});

	it("--daemon works regardless of its position relative to the positional argument", () => {
		expect(parseTerminalArgs(["--daemon", "http://127.0.0.1:4390", "/repos/lector"], {})).toEqual({ path: "/repos/lector", daemonUrl: "http://127.0.0.1:4390" });
	});

	it("falls back to ZODIAC_DAEMON_URL when --daemon is not given", () => {
		expect(parseTerminalArgs(["/repos/lector"], { ZODIAC_DAEMON_URL: "http://127.0.0.1:4390" })).toEqual({ path: "/repos/lector", daemonUrl: "http://127.0.0.1:4390" });
	});

	it("--daemon overrides ZODIAC_DAEMON_URL when both are given", () => {
		expect(parseTerminalArgs(["--daemon", "http://explicit:1"], { ZODIAC_DAEMON_URL: "http://from-env:2" })).toEqual({ path: undefined, daemonUrl: "http://explicit:1" });
	});
});
