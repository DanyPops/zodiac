import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { afterEach, describe, expect, it } from "vitest";

/**
 * "daily-drive" acceptance -- checklist item "Lector performs the coding
 * workflow": target code is inspected (opened, real current content and
 * hash read back) and edited (a hash-guarded save that only succeeds
 * against the exact content just read, matching GuardedLiveBuffer's own
 * real contract) purely through zodiacd's native Lector contribution
 * dispatch path (integration.invoke), against a fixture editor
 * contribution shaped like Lector's own real open/save operations rather
 * than the real Lector package (a committed test must stay portable and
 * fast, per this session's own established practice; the real Lector
 * Integration's hasApi:true wiring was proven separately in
 * agent-invokable-lector-integration.system.test.ts, and Lector's own
 * package-level guarded-save behavior is tested exhaustively in its own
 * repository).
 */
const cli = new URL("../dist/cli.js", import.meta.url).pathname;
const roots: string[] = [];
const daemons: ManagedProcess[] = [];

function temporaryRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	return root;
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

afterEach(async () => {
	await Promise.all(daemons.splice(0).map((daemon) => daemon.dispose()));
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("daily-drive: Lector acceptance", () => {
	it("inspects a real file's current content/hash, then edits it with a hash-guarded save that only succeeds against exactly that hash", async () => {
		const files = new Map<string, { content: string; hash: string }>([["src/a.ts", { content: "export const x = 1;\n", hash: "hash-v1" }]]);

		const packageRoot = temporaryRoot("zodiac-daily-drive-lector-");
		writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
			name: "@fixture/daily-drive-lector",
			version: "1.0.0",
			zodiac: { integrations: [{ kind: "editor", entry: "./editor.mjs" }] },
		}));
		// A fixture editor shaped like Lector's own real open/save contract:
		// open returns the file's current content and hash; save requires the
		// exact expectedHash open just handed back, mints a fresh hash on
		// success, and rejects a stale/mismatched hash instead of silently
		// overwriting -- the same guard GuardedLiveBuffer enforces for real.
		writeFileSync(join(packageRoot, "editor.mjs"), `
			const files = new Map([["src/a.ts", { content: "export const x = 1;\\n", hash: "hash-v1" }]]);
			export default {
				describe: () => ({ id: "lector", title: "Lector", commands: [{ id: "lector.file.open", title: "Open File" }, { id: "lector.file.save", title: "Save File" }], resourceSchemes: [], capabilities: ["agent-invokable"], contributionPoints: ["editor"] }),
				activate: (host) => {
					host.registerCommand({ id: "lector.file.open", title: "Open File", execute: async (input) => {
						const file = files.get(input.path);
						if (!file) return { ok: false, code: "not-found", message: "no such file: " + input.path };
						return { ok: true, value: { path: input.path, content: file.content, hash: file.hash } };
					} });
					host.registerCommand({ id: "lector.file.save", title: "Save File", execute: async (input) => {
						const file = files.get(input.path);
						if (!file) return { ok: false, code: "not-found", message: "no such file: " + input.path };
						if (input.expectedHash !== file.hash) return { ok: false, code: "stale-write", message: "File changed outside this editor; local edits were preserved" };
						file.content = input.content;
						file.hash = "hash-v2";
						return { ok: true, value: { path: input.path, newHash: file.hash } };
					} });
				},
				dispose: () => {},
			};
		`);

		const stateDir = temporaryRoot("zodiac-daily-drive-lector-state-");
		const daemon = spawnManagedProcess({ command: process.execPath, args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir, "--integration-package", join(packageRoot, "package.json")] });
		daemons.push(daemon);
		const stdout = await waitForStdout(daemon, /listening on http:\/\//);
		const baseUrl = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
		if (!baseUrl) throw new Error(`missing zodiacd URL in ${stdout}`);

		async function invoke(action: string, input: unknown): Promise<{ ok: boolean; value?: unknown; code?: string; message?: string }> {
			const response = await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "integration.invoke", workspaceId: "ws-lector", integrationId: "lector", action, input } }) });
			const body = await response.json() as { result?: { invoke?: { ok: boolean; value?: unknown; code?: string; message?: string } } };
			if (!body.result?.invoke) throw new Error(`no invoke result: ${JSON.stringify(body)}`);
			return body.result.invoke;
		}

		await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: "ws-lector", title: "Coding" } }) });
		await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "surface.dock", workspaceId: "ws-lector", integrationId: "lector", title: "Lector" } }) });

		// Inspect: open reads real current content and hash.
		const opened = await invoke("lector.file.open", { path: "src/a.ts" });
		expect(opened).toEqual({ ok: true, value: { path: "src/a.ts", content: "export const x = 1;\n", hash: "hash-v1" } });

		// Edit: a save against a STALE hash is rejected -- the guard actually works, not a no-op.
		const staleSave = await invoke("lector.file.save", { path: "src/a.ts", expectedHash: "wrong-hash", content: "export const x = 2;\n" });
		expect(staleSave).toMatchObject({ ok: false, code: "stale-write" });

		// Edit: a save against the exact hash just inspected succeeds.
		const opened2 = opened as { ok: true; value: { hash: string } };
		const saved = await invoke("lector.file.save", { path: "src/a.ts", expectedHash: opened2.value.hash, content: "export const x = 2;\n" });
		expect(saved).toEqual({ ok: true, value: { path: "src/a.ts", newHash: "hash-v2" } });

		// A fresh inspect confirms the edit actually landed, with a new hash guarding the next one.
		const reopened = await invoke("lector.file.open", { path: "src/a.ts" });
		expect(reopened).toEqual({ ok: true, value: { path: "src/a.ts", content: "export const x = 2;\n", hash: "hash-v2" } });
	}, 20_000);
});
