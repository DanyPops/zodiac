import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveZodiacAgentDir, seedZodiacAuthOnce } from "./pi-agent-dir.js";

let root: string | undefined;

afterEach(() => {
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

describe("resolveZodiacAgentDir", () => {
	it("defaults to ~/.zodiac/pi-agent when no override is set", () => {
		const dir = resolveZodiacAgentDir({});
		expect(dir.endsWith(join(".zodiac", "pi-agent"))).toBe(true);
	});

	it("honors ZODIAC_PI_AGENT_DIR when set, mirroring pi's own PI_CODING_AGENT_DIR override convention", () => {
		const dir = resolveZodiacAgentDir({ ZODIAC_PI_AGENT_DIR: "/tmp/some-custom-dir" });
		expect(dir).toBe("/tmp/some-custom-dir");
	});

});

describe("seedZodiacAuthOnce", () => {
	it("copies auth.json from the source agent dir the first time, when the destination has none yet", () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-agent-dir-"));
		const sourceAgentDir = join(root, "source");
		const agentDir = join(root, "dest");
		mkdirSync(sourceAgentDir, { recursive: true });
		writeFileSync(join(sourceAgentDir, "auth.json"), JSON.stringify({ anthropic: { apiKey: "real-key" } }));

		seedZodiacAuthOnce({ agentDir, sourceAgentDir });

		expect(existsSync(join(agentDir, "auth.json"))).toBe(true);
		expect(readFileSync(join(agentDir, "auth.json"), "utf-8")).toBe(JSON.stringify({ anthropic: { apiKey: "real-key" } }));
	});

	it("never overwrites an already-existing destination auth.json -- a deliberately different Zodiac-side auth is never clobbered", () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-agent-dir-"));
		const sourceAgentDir = join(root, "source");
		const agentDir = join(root, "dest");
		mkdirSync(sourceAgentDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(sourceAgentDir, "auth.json"), JSON.stringify({ anthropic: { apiKey: "personal-key" } }));
		writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ anthropic: { apiKey: "zodiac-own-key" } }));

		seedZodiacAuthOnce({ agentDir, sourceAgentDir });

		expect(readFileSync(join(agentDir, "auth.json"), "utf-8")).toBe(JSON.stringify({ anthropic: { apiKey: "zodiac-own-key" } }));
	});

	it("no-ops silently when the source has no auth.json to copy -- never throws", () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-agent-dir-"));
		const sourceAgentDir = join(root, "source"); // deliberately never created
		const agentDir = join(root, "dest");

		expect(() => seedZodiacAuthOnce({ agentDir, sourceAgentDir })).not.toThrow();
		expect(existsSync(join(agentDir, "auth.json"))).toBe(false);
	});

	it("creates the destination agent dir itself if it doesn't exist yet", () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-agent-dir-"));
		const sourceAgentDir = join(root, "source");
		const agentDir = join(root, "dest", "nested"); // never created ahead of time
		mkdirSync(sourceAgentDir, { recursive: true });
		writeFileSync(join(sourceAgentDir, "auth.json"), "{}");

		seedZodiacAuthOnce({ agentDir, sourceAgentDir });

		expect(existsSync(join(agentDir, "auth.json"))).toBe(true);
	});

});
