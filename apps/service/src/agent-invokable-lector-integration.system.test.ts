import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The end-to-end proof for "Give Lector's Zodiac Integration hasApi:true so
 * the embedded agent can actually edit code": a real spawned zodiacd, a
 * fixture editor contribution declaring the agent-invokable capability tag
 * (the same mechanism a real Lector package uses), docked as a Surface,
 * then a real `integration.invoke` CommandIntent posted to
 * /api/world/commands -- the identical transport zodiac_dispatch_command
 * itself posts to -- reaching the contribution's own registered command.
 * Also proves a contribution that never declares the tag stays
 * renderable-only: docked, but integration.invoke against it is rejected,
 * the same "no first-party fast path" boundary every other Integration
 * goes through.
 */
const cli = new URL("../dist/cli.js", import.meta.url).pathname;
const roots: string[] = [];
const daemons: ManagedProcess[] = [];

function temporaryRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

function spawnZodiacd(stateDir: string, packageJsonPath: string): ManagedProcess {
	const daemon = spawnManagedProcess({ command: process.execPath, args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir, "--integration-package", packageJsonPath] });
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

function writeFixtureLectorPackage(packageRoot: string, options: { agentInvokable: boolean; saveResult: string }): void {
	writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "@fixture/agent-invokable-lector", version: "1.0.0", zodiac: { integrations: [{ kind: "editor", entry: "./editor.mjs" }] } }));
	const capabilities = options.agentInvokable ? `["agent-invokable"]` : `[]`;
	writeFileSync(join(packageRoot, "editor.mjs"), `export default {
		describe: () => ({ id: "lector", title: "Lector", commands: [{ id: "lector.file.save", title: "Save File" }], resourceSchemes: [], capabilities: ${capabilities}, contributionPoints: ["editor"] }),
		activate: (host) => { host.registerCommand({ id: "lector.file.save", title: "Save File", execute: async (input) => ({ ok: true, value: { uri: "lector://file/" + input.path, kind: "file", title: input.path, readOnly: false } }) }); },
		dispose: () => {},
	};\n`);
}

afterEach(async () => {
	await Promise.all(daemons.splice(0).map((daemon) => daemon.dispose()));
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("integration.invoke reaches a real editor contribution's own registered command", () => {
	it("an agent-invokable Lector Surface's file.save action round-trips through the exact transport zodiac_dispatch_command itself posts to", async () => {
		const packageRoot = temporaryRoot("zodiac-agent-invokable-lector-");
		const stateDir = temporaryRoot("zodiac-agent-invokable-state-");
		writeFixtureLectorPackage(packageRoot, { agentInvokable: true, saveResult: "saved" });

		const daemon = spawnZodiacd(stateDir, join(packageRoot, "package.json"));
		const stdout = await waitForStdout(daemon, /listening on http:\/\//);
		const baseUrl = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
		if (!baseUrl) throw new Error(`missing zodiacd URL in ${stdout}`);

		const create = await (await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: "ws-lector", title: "Coding" } }) })).json() as { accepted: boolean };
		expect(create.accepted).toBe(true);
		const dock = await (await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "surface.dock", workspaceId: "ws-lector", integrationId: "lector", title: "Lector" } }) })).json() as { accepted: boolean };
		expect(dock.accepted).toBe(true);

		const response = await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "integration.invoke", workspaceId: "ws-lector", integrationId: "lector", action: "lector.file.save", input: { path: "src/a.ts" } } }) });
		const body = await response.json() as { accepted: boolean; result?: { invoke?: { ok: boolean; value?: { uri: string } } } };

		expect(response.status).toBe(200);
		expect(body).toMatchObject({ accepted: true, result: { invoke: { ok: true, value: { uri: "lector://file/src/a.ts" } } } });
	}, 20_000);

	it("a contribution that never declares agent-invokable stays renderable-only -- docked fine, but integration.invoke against it is rejected", async () => {
		const packageRoot = temporaryRoot("zodiac-non-invokable-lector-");
		const stateDir = temporaryRoot("zodiac-non-invokable-state-");
		writeFixtureLectorPackage(packageRoot, { agentInvokable: false, saveResult: "saved" });

		const daemon = spawnZodiacd(stateDir, join(packageRoot, "package.json"));
		const stdout = await waitForStdout(daemon, /listening on http:\/\//);
		const baseUrl = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
		if (!baseUrl) throw new Error(`missing zodiacd URL in ${stdout}`);

		const create = await (await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: "ws-lector", title: "Coding" } }) })).json() as { accepted: boolean };
		expect(create.accepted).toBe(true);
		const dock = await (await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "surface.dock", workspaceId: "ws-lector", integrationId: "lector", title: "Lector" } }) })).json() as { accepted: boolean };
		expect(dock.accepted).toBe(true);

		const response = await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "integration.invoke", workspaceId: "ws-lector", integrationId: "lector", action: "lector.file.save", input: { path: "src/a.ts" } } }) });

		expect(response.status).toBe(400);
		const body = await response.json() as { code: string; message: string };
		expect(body.code).toBe("command-failed");
		expect(body.message).toMatch(/no registered integration\.invoke handler/);
	}, 20_000);
});
