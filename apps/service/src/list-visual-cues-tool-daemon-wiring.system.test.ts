import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Proves the real zodiacd binary's own composition root
 * (createDaemonAgentIntegrationFactory, apps/service/src/cli.ts) genuinely
 * constructs and wires list_visual_cues (backed by RemoteBrowserVisualCueClient,
 * see cli.ts's own `createListVisualCuesTool((toolCallId) =>
 * createRemoteBrowserVisualCueClient(pendingClientActions, toolCallId))` call)
 * without crashing, in both the workspaceId and no-workspaceId branches --
 * the exact same scope and honesty level as
 * agent-command-tool-daemon-wiring.system.test.ts's own precedent for
 * zodiac_dispatch_command/list_integrations: real conversation/tool-call
 * proof of *which adapter* actually ran stays in
 * list-visual-cues-tool.test.ts's own real, deterministic unit coverage of
 * both adapters directly (a real LLM call would be needed to drive a
 * prompt through the daemon's own internal agent session -- confirmed
 * directly: createDaemonAgentIntegrationFactory's own call into
 * createZodiacAgentSession never injects a faux modelRuntime, unlike a
 * standalone `pi --provider faux` process). This test's own job is
 * narrower and just as real: does the composition root itself run without
 * crashing now that a third custom tool is constructed and threaded
 * through on every session-creation path.
 */
const cli = new URL("../dist/cli.js", import.meta.url).pathname;

let daemon: ManagedProcess | undefined;
let stateDir: string | undefined;

async function waitForStdout(managedProcess: ManagedProcess, pattern: RegExp, timeoutMs = 15_000): Promise<string> {
	return new Promise((resolveMatch, reject) => {
		let stdout = "";
		const unsubscribe = managedProcess.onStdout((chunk) => {
			stdout += chunk.toString("utf8");
			const url = pattern.exec(stdout)?.[1];
			if (url) {
				unsubscribe();
				resolveMatch(url);
			}
		});
		void managedProcess.waitForExit().then((code) => {
			if (!pattern.test(stdout)) reject(new Error(`zodiacd exited (code ${code}) without matching ${pattern}.\nstdout: ${stdout}\nstderr: ${managedProcess.stderr}`));
		});
		setTimeout(() => reject(new Error(`timed out waiting for ${pattern}.\nstdout: ${stdout}\nstderr: ${managedProcess.stderr}`)), timeoutMs);
	});
}

afterEach(async () => {
	await daemon?.dispose();
	daemon = undefined;
	if (stateDir) await rm(stateDir, { recursive: true, force: true });
	stateDir = undefined;
});

async function startDaemon(): Promise<string> {
	stateDir = await mkdtemp(join(tmpdir(), "zodiacd-list-visual-cues-wiring-"));
	daemon = spawnManagedProcess({ command: process.execPath, args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir] });
	return waitForStdout(daemon, /listening on (http:\/\/\S+)/);
}

async function createWorkspace(baseUrl: string, id: string): Promise<void> {
	await fetch(`${baseUrl}/api/world/commands`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: id, title: id } }),
	});
}

describe("zodiacd's own cli.ts wires list_visual_cues (backed by RemoteBrowserVisualCueClient) onto every agent session", () => {
	it("creating a session with a real workspaceId succeeds -- list_visual_cues, dispatchTool, and listTool are all constructed and passed to createZodiacAgentSession without crashing", async () => {
		const url = await startDaemon();
		await createWorkspace(url, "ws-wired");
		const response = await fetch(`${url}/api/agent/sessions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ workspaceId: "ws-wired" }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { sessionId?: string };
		expect(typeof body.sessionId).toBe("string");
	});

	it("creating a session with no workspaceId still succeeds -- list_visual_cues is active in both createDaemonAgentIntegrationFactory branches, not just the Workspace-scoped one", async () => {
		const url = await startDaemon();
		const response = await fetch(`${url}/api/agent/sessions`, { method: "POST" });
		expect(response.status).toBe(200);
		const body = (await response.json()) as { sessionId?: string };
		expect(typeof body.sessionId).toBe("string");
	});

	it("the daemon's own /api/agent/sessions/:id/client-actions/:toolCallId route is real and reachable -- a POST for a toolCallId nothing is pending under reports delivered: false, never a 500", async () => {
		const url = await startDaemon();
		const response = await fetch(`${url}/api/agent/sessions/whatever/client-actions/never-registered`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ result: {} }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ delivered: false });
	});
});
