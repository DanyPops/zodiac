import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type LiveTerminal, spawnLiveTerminal } from "../test/live-pty-terminal.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = resolve(packageRoot, "dist/cli.js");

let root: string | undefined;
let terminal: LiveTerminal | undefined;

afterEach(async () => {
	await terminal?.dispose();
	terminal = undefined;
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

describe("real CLI boot with a real per-workspace pi-setup.json/profiles.json, against this machine's real globally-installed extensions", () => {
	it("boots without crashing -- the hermetic unit test (start-footer-chat.test.ts) proves the narrowing mechanism itself with a synthetic extension and noExtensions:true; this proves the fix's real integration point (DefaultResourceLoader's real extension discovery, a real installed @danypops/pi-packed, a real bindExtensions() call) doesn't break under conditions the hermetic test deliberately bypasses", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-tui-profile-pty-"));
		mkdirSync(join(root, ".pi"));
		writeFileSync(join(root, "pi-setup.json"), JSON.stringify({ schemaVersion: 1, defaultProfile: "smoke" }));
		writeFileSync(join(root, ".pi", "profiles.json"), JSON.stringify({ smoke: { tools: ["read"] } }));
		writeFileSync(join(root, "a.ts"), "export const a = 1;\n");

		terminal = spawnLiveTerminal(process.execPath, [cli, root], { cols: 80, rows: 24 });
		// This machine's real ~/.pi/agent/settings.json loads several real
		// global extensions (pi-anthropic-vertex, pi-packed, pi-lector, ...),
		// and dist/cli.js's own unbundled @earendil-works/* (a real, deliberate
		// build-config fix -- see start-footer-chat.ts's doc comment) makes
		// this genuinely slower to cold-start than a self-contained bundle.
		await terminal.waitForText("Chat", 20_000);
		const snapshot = terminal.snapshot();
		expect(snapshot).toContain("Chat");
		expect(snapshot).not.toContain("Zodiac: ");
	}, 25_000);
});
