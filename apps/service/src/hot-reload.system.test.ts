import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { afterEach, describe, expect, it } from "vitest";

// Real end-to-end proof of task "Build transactional hot-reload for Zodiac
// contributions": a real spawned zodiacd, with real polling enabled via
// --hot-reload-poll-ms, detects a real on-disk file edit and swaps in the
// new behavior with no restart -- the acceptance criterion the task itself
// states verbatim ("the running zodiacd detects it... with no zodiacd
// restart"). A second test proves the transactional half: a deliberately
// broken update never takes the daemon's own editor contribution down.

const cli = new URL("../dist/cli.js", import.meta.url).pathname;
const roots: string[] = [];
const daemons: ManagedProcess[] = [];

function temporaryRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

function spawnZodiacd(stateDir: string, packageJsonPath: string, hotReloadPollMs: number): ManagedProcess {
	const daemon = spawnManagedProcess({ command: process.execPath, args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir, "--integration-package", packageJsonPath, "--hot-reload-poll-ms", String(hotReloadPollMs)] });
	daemons.push(daemon);
	return daemon;
}

async function waitForStdout(process: ManagedProcess, pattern: RegExp, timeoutMs = 15_000): Promise<string> {
	return new Promise((resolve, reject) => {
		let stdout = "";
		const unsubscribe = process.onStdout((chunk) => {
			stdout += chunk.toString("utf8");
			if (pattern.test(stdout)) {
				unsubscribe();
				resolve(stdout);
			}
		});
		void process.waitForExit().then((code) => reject(new Error(`zodiacd exited (${code}) before ${pattern}\nstdout: ${stdout}\nstderr: ${process.stderr}`)));
		setTimeout(() => reject(new Error(`timed out waiting for ${pattern}\nstdout: ${stdout}\nstderr: ${process.stderr}`)), timeoutMs);
	});
}

// zodiacd logs a hot-reload failure via console.error, not console.log --
// ManagedProcess exposes no onStderr subscription (only stdout has one),
// so this polls the accumulated .stderr snapshot instead of subscribing.
async function waitForStderr(process: ManagedProcess, pattern: RegExp, timeoutMs = 15_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (pattern.test(process.stderr)) return process.stderr;
		if (Date.now() >= deadline) throw new Error(`timed out waiting for ${pattern} on stderr\nstderr: ${process.stderr}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

function editorSource(version: string): string {
	// dispose must call the unregister function host.registerCommand
	// returns -- otherwise the old instance's own "hot.version" command
	// registration outlives it, and the fresh instance's own attempt to
	// register the same command id collides (a real bug this exact test
	// surfaced against the first draft of this fixture: an editor
	// contribution that forgets to unregister its own commands on
	// dispose looks, from configured-loader's own perspective, exactly
	// like "the fresh activation itself failed").
	return `let unregister; export default { describe: () => ({ id: "hot", title: "Hot ${version}", commands: [{ id: "hot.version" }], resourceSchemes: [], contributionPoints: ["editor"] }), activate: (host) => { unregister = host.registerCommand({ id: "hot.version", title: "Version", execute: async () => ({ ok: true, value: "${version}" }) }); }, dispose: () => { unregister?.(); } };\n`;
}

afterEach(async () => {
	await Promise.all(daemons.splice(0).map((daemon) => daemon.dispose()));
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("zodiacd hot-reload polling", () => {
	it("detects a real on-disk edit and swaps the running editor contribution's behavior with no restart", async () => {
		const packageRoot = temporaryRoot("zodiac-hot-reload-");
		const stateDir = temporaryRoot("zodiac-hot-reload-state-");
		const entry = join(packageRoot, "editor.mjs");
		writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "@fixture/hot", version: "1.0.0", zodiac: { integrations: [{ kind: "editor", entry: "./editor.mjs" }] } }));
		writeFileSync(entry, editorSource("v1"));

		const daemon = spawnZodiacd(stateDir, join(packageRoot, "package.json"), 200);
		const stdout = await waitForStdout(daemon, /hot-reload polling enabled every 200ms/);
		const baseUrl = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
		if (!baseUrl) throw new Error(`missing zodiacd URL in ${stdout}`);

		const before = await (await fetch(`${baseUrl}/api/contributions/hot/invoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "hot.version", input: {} }) })).json() as { ok: boolean; value: string };
		expect(before).toEqual({ ok: true, value: "v1" });

		await new Promise((resolve) => setTimeout(resolve, 10)); // ensure a distinct mtime
		writeFileSync(entry, editorSource("v2"));
		await waitForStdout(daemon, /hot-reloaded configured Integration package: @fixture\/hot/, 10_000);

		const after = await (await fetch(`${baseUrl}/api/contributions/hot/invoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "hot.version", input: {} }) })).json() as { ok: boolean; value: string };
		expect(after).toEqual({ ok: true, value: "v2" });
	}, 20_000);

	it("a broken on-disk edit is rejected and the daemon keeps serving the prior, still-good behavior -- no restart, no half-swapped state", async () => {
		const packageRoot = temporaryRoot("zodiac-hot-reload-broken-");
		const stateDir = temporaryRoot("zodiac-hot-reload-broken-state-");
		const entry = join(packageRoot, "editor.mjs");
		writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "@fixture/hot-broken", version: "1.0.0", zodiac: { integrations: [{ kind: "editor", entry: "./editor.mjs" }] } }));
		writeFileSync(entry, editorSource("v1"));

		const daemon = spawnZodiacd(stateDir, join(packageRoot, "package.json"), 200);
		const stdout = await waitForStdout(daemon, /hot-reload polling enabled every 200ms/);
		const baseUrl = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
		if (!baseUrl) throw new Error(`missing zodiacd URL in ${stdout}`);

		await new Promise((resolve) => setTimeout(resolve, 10));
		writeFileSync(entry, "export default {};\n"); // invalid export -- fails isEditorContribution's own guard
		await waitForStderr(daemon, /hot-reload failed for @fixture\/hot-broken/, 10_000);

		const stillGood = await (await fetch(`${baseUrl}/api/contributions/hot/invoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "hot.version", input: {} }) })).json() as { ok: boolean; value: string };
		expect(stillGood).toEqual({ ok: true, value: "v1" });
	}, 20_000);
});
