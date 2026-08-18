import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the real zodiacd binary (not agent-command-tool.process.test.ts's
 * own fixture, see 542c32d2) actually registers zodiac_dispatch_command on
 * a Workspace-scoped session without crashing -- the concrete gap that task
 * closes. Real conversation/tool-call proof stays in the fixture-based
 * tests (real LLM auth isn't available/desirable in this suite); this
 * covers the wiring itself: does createDaemonAgentIntegrationFactory's
 * getDaemonBaseUrl closure resolve correctly once the daemon is actually
 * listening, and does a no-workspaceId caller keep working unchanged.
 */
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
	stateDir = await mkdtemp(join(tmpdir(), "zodiacd-agent-command-tool-wiring-"));
	const cli = new URL("../dist/cli.js", import.meta.url).pathname;
	daemon = spawn(process.execPath, [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir], { stdio: ["ignore", "pipe", "pipe"] });
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

async function createWorkspace(id: string): Promise<void> {
	await fetch(`${baseUrl}/api/world/commands`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: id, title: id } }),
	});
}

describe("zodiacd's own cli.ts wires zodiac_dispatch_command onto a real, Workspace-scoped agent session", () => {
	it("creating a session with a real workspaceId succeeds -- the tool/grant construction and the daemonBaseUrl closure both resolve without crashing", async () => {
		await createWorkspace("ws-wired");
		const response = await fetch(`${baseUrl}/api/agent/sessions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ workspaceId: "ws-wired" }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { sessionId?: string };
		expect(typeof body.sessionId).toBe("string");
	});

	it("creating a session with no workspaceId still succeeds, unchanged -- the tool/grant path is additive, not a regression for a cwd-only caller", async () => {
		const response = await fetch(`${baseUrl}/api/agent/sessions`, { method: "POST" });
		expect(response.status).toBe(200);
		const body = (await response.json()) as { sessionId?: string };
		expect(typeof body.sessionId).toBe("string");
	});

	it("creating two sessions for two different Workspaces both succeed independently", async () => {
		await createWorkspace("ws-a");
		await createWorkspace("ws-b");
		const [a, b] = await Promise.all([
			fetch(`${baseUrl}/api/agent/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: "ws-a" }) }),
			fetch(`${baseUrl}/api/agent/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: "ws-b" }) }),
		]);
		expect(a.status).toBe(200);
		expect(b.status).toBe(200);
		const [aBody, bBody] = (await Promise.all([a.json(), b.json()])) as [{ sessionId: string }, { sessionId: string }];
		expect(aBody.sessionId).not.toBe(bBody.sessionId);
	});
});
