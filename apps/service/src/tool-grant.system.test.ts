import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type ZodiacdProcess = ChildProcessByStdio<null, Readable, Readable>;

let daemon: ZodiacdProcess;
let baseUrl: string;
let stateDir: string;

async function waitForReady(child: ZodiacdProcess): Promise<string> {
	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		const onData = (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
			const match = /listening on (http:\/\/\S+)/.exec(stdout);
			const url = match?.[1];
			if (url) {
				child.stdout.off("data", onData);
				resolve(url);
			}
		};
		child.stdout.on("data", onData);
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.once("exit", (code) => reject(new Error(`zodiacd exited early (code ${code}) before reporting ready.\nstderr: ${stderr}`)));
		child.once("error", reject);
		setTimeout(() => reject(new Error(`zodiacd did not report ready within 15s.\nstdout: ${stdout}\nstderr: ${stderr}`)), 15_000);
	});
}

beforeAll(async () => {
	stateDir = await mkdtemp(join(tmpdir(), "zodiacd-tool-grant-"));
	const cli = new URL("../dist/cli.js", import.meta.url).pathname;
	daemon = spawn(
		process.execPath,
		[cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir],
		{
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				ZODIAC_TOOL_INTEGRATIONS: JSON.stringify([{ id: "lector", title: "Lector", capabilities: { renderable: true, hasApi: true } }]),
				ZODIAC_TOOL_CONTRIBUTIONS: JSON.stringify([{ integrationId: "lector", toolId: "lector.fs" }]),
			},
		},
	);
	baseUrl = await waitForReady(daemon);
}, 20_000);

afterAll(async () => {
	if (daemon && !daemon.killed) {
		daemon.kill("SIGTERM");
		await new Promise<void>((resolve) => {
			daemon.once("exit", () => resolve());
			setTimeout(resolve, 2000);
		});
	}
	await rm(stateDir, { recursive: true, force: true });
});

async function getTools(workspaceId: string): Promise<readonly string[]> {
	const res = await fetch(`${baseUrl}/api/world/workspaces/${workspaceId}/tools`);
	const body = (await res.json()) as { toolIds: readonly string[] };
	return body.toolIds;
}

describe("zodiacd: docking/undocking an Integration changes a live agent tool grant", () => {
	it("granting and revoking a tool tracks a real dock/undock over the live daemon", async () => {
		await fetch(`${baseUrl}/api/world/commands`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: "ws-tools", title: "Tools" } }),
		});
		expect(await getTools("ws-tools")).toEqual([]);

		const docked = await fetch(`${baseUrl}/api/world/commands`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ intent: { type: "surface.dock", workspaceId: "ws-tools", integrationId: "lector", title: "Lector" } }),
		});
		const { result } = (await docked.json()) as { result: { surfaceId: string } };
		expect(await getTools("ws-tools")).toEqual(["lector.fs"]);

		await fetch(`${baseUrl}/api/world/commands`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ intent: { type: "surface.undock", workspaceId: "ws-tools", surfaceId: result.surfaceId } }),
		});
		expect(await getTools("ws-tools")).toEqual([]);
	});
});
