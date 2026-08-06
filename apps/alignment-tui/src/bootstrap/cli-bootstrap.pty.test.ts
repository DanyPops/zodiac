import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as pty from "node-pty";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { startIsolatedLectorDaemon } from "../test/isolated-lector-daemon.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = resolve(packageRoot, "dist/cli.js");

function waitFor(read: () => string, expected: string, timeoutMs = 8_000): Promise<void> {
	return new Promise((resolveWait, reject) => {
		const started = Date.now();
		const poll = () => {
			if (read().includes(expected)) return resolveWait();
			if (Date.now() - started > timeoutMs) return reject(new Error(`PTY did not emit ${JSON.stringify(expected)}; tail=${JSON.stringify(read().slice(-800))}`));
			setTimeout(poll, 25);
		};
		poll();
	});
}

let root: string | undefined;
let stopDaemon: (() => Promise<void>) | undefined;
let child: pty.IPty | undefined;

afterEach(async () => {
	try {
		child?.kill();
	} catch {
		/* already exited */
	}
	child = undefined;
	await stopDaemon?.();
	stopDaemon = undefined;
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

describe("real CLI process bootstrap against a real Lector daemon", () => {
	it("opens a real fixture directory and projects its own title into the World -- no longer the empty shell", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-cli-e2e-dir-"));
		writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
		mkdirSync(join(root, "src"));
		const rootTitle = basename(root);

		const daemon = await startIsolatedLectorDaemon();
		stopDaemon = daemon.stop;
		child = pty.spawn(process.execPath, [cli, root], { cols: 80, rows: 24, env: { ...process.env, TERM: "xterm-256color" } });
		let output = "";
		child.onData((data) => {
			output += data;
		});
		try {
			await waitFor(() => stripTerminalSequences(output), rootTitle);
			const text = stripTerminalSequences(output);
			expect(text).not.toContain("No workspace open");
			expect(text).toContain("Windows");
			expect(text).not.toContain("Windows: none");
		} finally {
			child.kill();
		}
	}, 15_000);

	it("opens a real fixture file directly, identifying its nearest real git repository root as the Workspace", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-cli-e2e-file-"));
		execFileSync("git", ["init", "-q"], { cwd: root });
		writeFileSync(join(root, "greet.ts"), "export function greet() {\n\treturn 'hi';\n}\n");
		const rootTitle = basename(root);

		const daemon = await startIsolatedLectorDaemon();
		stopDaemon = daemon.stop;
		child = pty.spawn(process.execPath, [cli, join(root, "greet.ts")], { cols: 80, rows: 24, env: { ...process.env, TERM: "xterm-256color" } });
		let output = "";
		child.onData((data) => {
			output += data;
		});
		try {
			await waitFor(() => stripTerminalSequences(output), rootTitle);
			expect(stripTerminalSequences(output)).not.toContain("No workspace open");
		} finally {
			child.kill();
		}
	}, 15_000);

	it("fails closed with a typed message and a non-zero exit for a path that does not exist -- never booting the TUI", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-cli-e2e-missing-"));
		const missing = join(root, "does-not-exist");
		let stdout = "";
		let stderr = "";
		let exitCode: number | undefined;
		await new Promise<void>((resolveExit) => {
			const proc = pty.spawn(process.execPath, [cli, missing], { cols: 80, rows: 24, env: { ...process.env, TERM: "xterm-256color" } });
			proc.onData((data) => {
				stdout += data;
			});
			proc.onExit(({ exitCode: code }) => {
				exitCode = code;
				resolveExit();
			});
		});
		expect(stripTerminalSequences(stdout)).toContain("no such path");
		expect(stdout).not.toContain("Windows:");
		expect(exitCode).toBe(1);
		void stderr;
	}, 10_000);
});
