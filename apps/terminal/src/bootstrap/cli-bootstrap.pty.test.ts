import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { startIsolatedLectorDaemon } from "../test/isolated-lector-daemon.js";
import { type LiveTerminal, spawnLiveTerminal } from "../test/live-pty-terminal.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = resolve(packageRoot, "dist/cli.js");

let root: string | undefined;
let stopDaemon: (() => Promise<void>) | undefined;
let terminal: LiveTerminal | undefined;

afterEach(async () => {
	await terminal?.dispose();
	terminal = undefined;
	await stopDaemon?.();
	stopDaemon = undefined;
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

describe("real CLI process bootstrap against a real Lector daemon", () => {
	it("opens a real fixture directory and projects its own title into the World -- no longer the empty shell", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-cli-e2e-dir-"));
		writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
		mkdirSync(join(root, "src"));
		const rootTitle = basename(root);

		const daemon = await startIsolatedLectorDaemon();
		stopDaemon = daemon.stop;
		terminal = spawnLiveTerminal(process.execPath, [cli, root], { cols: 80, rows: 24 });
		await terminal.waitForText(rootTitle, 15_000);
		const text = terminal.snapshot();
		expect(text).not.toContain("No workspace open");
		expect(text).toContain("Windows");
		expect(text).not.toContain("Windows: none");
	}, 15_000);

	it("opens a real fixture file directly, identifying its nearest real git repository root as the Workspace", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-cli-e2e-file-"));
		execFileSync("git", ["init", "-q"], { cwd: root });
		writeFileSync(join(root, "greet.ts"), "export function greet() {\n\treturn 'hi';\n}\n");
		const rootTitle = basename(root);

		const daemon = await startIsolatedLectorDaemon();
		stopDaemon = daemon.stop;
		terminal = spawnLiveTerminal(process.execPath, [cli, join(root, "greet.ts")], { cols: 80, rows: 24 });
		await terminal.waitForText(rootTitle, 15_000);
		expect(terminal.snapshot()).not.toContain("No workspace open");
	}, 15_000);

	it("fails closed with a typed message and a non-zero exit for a path that does not exist -- never booting the TUI", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-cli-e2e-missing-"));
		const missing = join(root, "does-not-exist");
		terminal = spawnLiveTerminal(process.execPath, [cli, missing], { cols: 80, rows: 24 });
		await terminal.waitForText("no such path", 10_000);
		const exitCode = await terminal.waitForExit(5_000);
		expect(terminal.snapshot()).not.toContain("Windows:");
		expect(exitCode).toBe(1);
	}, 10_000);
});
