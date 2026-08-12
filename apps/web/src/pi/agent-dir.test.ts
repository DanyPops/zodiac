import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAlignmentAgentDir, seedAlignmentAuthOnce } from "./agent-dir.js";

/**
 * Mirrors @zodiac/server's own pi-agent-dir.test.ts -- see agent-dir.ts's
 * own doc comment for why this file (and the implementation it tests) is a
 * deliberate local duplicate rather than a shared import.
 */

let root: string | undefined;

afterEach(() => {
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

describe("resolveAlignmentAgentDir", () => {
	it("defaults to ~/.alignment/pi-agent when no override is set", () => {
		const dir = resolveAlignmentAgentDir({});
		expect(dir.endsWith(join(".alignment", "pi-agent"))).toBe(true);
	});

	it("honors ALIGNMENT_PI_AGENT_DIR when set", () => {
		const dir = resolveAlignmentAgentDir({ ALIGNMENT_PI_AGENT_DIR: "/tmp/some-custom-dir" });
		expect(dir).toBe("/tmp/some-custom-dir");
	});
});

describe("seedAlignmentAuthOnce", () => {
	it("copies auth.json from the source agent dir the first time", () => {
		root = mkdtempSync(join(tmpdir(), "alignment-agent-dir-"));
		const sourceAgentDir = join(root, "source");
		const agentDir = join(root, "dest");
		mkdirSync(sourceAgentDir, { recursive: true });
		writeFileSync(join(sourceAgentDir, "auth.json"), JSON.stringify({ anthropic: { apiKey: "real-key" } }));

		seedAlignmentAuthOnce({ agentDir, sourceAgentDir });

		expect(existsSync(join(agentDir, "auth.json"))).toBe(true);
		expect(readFileSync(join(agentDir, "auth.json"), "utf-8")).toBe(JSON.stringify({ anthropic: { apiKey: "real-key" } }));
	});

	it("never overwrites an already-existing destination auth.json", () => {
		root = mkdtempSync(join(tmpdir(), "alignment-agent-dir-"));
		const sourceAgentDir = join(root, "source");
		const agentDir = join(root, "dest");
		mkdirSync(sourceAgentDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(sourceAgentDir, "auth.json"), JSON.stringify({ anthropic: { apiKey: "personal-key" } }));
		writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ anthropic: { apiKey: "alignment-own-key" } }));

		seedAlignmentAuthOnce({ agentDir, sourceAgentDir });

		expect(readFileSync(join(agentDir, "auth.json"), "utf-8")).toBe(JSON.stringify({ anthropic: { apiKey: "alignment-own-key" } }));
	});

	it("no-ops silently when the source has no auth.json to copy", () => {
		root = mkdtempSync(join(tmpdir(), "alignment-agent-dir-"));
		const sourceAgentDir = join(root, "source");
		const agentDir = join(root, "dest");

		expect(() => seedAlignmentAuthOnce({ agentDir, sourceAgentDir })).not.toThrow();
		expect(existsSync(join(agentDir, "auth.json"))).toBe(false);
	});
});
