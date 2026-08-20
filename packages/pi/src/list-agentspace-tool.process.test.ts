import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { encodeFauxScript, resolveFauxProviderExtensionPath, resolvePiCliPath, SCRIPT_ENV_VAR, spawnManagedProcess, spawnRealPiProcess, waitForRpcEvent, type ManagedProcess, type RealPiProcess } from "@danypops/pi-process-harness";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "../..");
const serviceCli = resolve(workspaceRoot, "apps/service/dist/cli.js");
const extensionPath = resolve(packageRoot, "src/fixtures/agent-command-extension.ts");

/**
 * TDD item 5 of the "Reshape list_integrations" Papyrus Task: proves
 * list_agentspace's own reported set changes live across a real
 * surface.dock, matching tool-grant.system.test.ts's own existing
 * dock/undock proof shape (deriveWorkspaceToolIds' own real fixture:
 * one hasApi Integration, one render-only one) but from this new read
 * tool's own perspective, driven through a real Pi process rather than a
 * raw HTTP tool-grant route.
 */
let daemon: ManagedProcess | undefined;
let stateDir: string | undefined;
let piProcess: RealPiProcess | undefined;

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

beforeAll(() => {
	execFileSync("npm", ["run", "build", "--workspace=@zodiac/service"], { cwd: workspaceRoot, stdio: "inherit" });
}, 60_000);

afterEach(async () => {
	await piProcess?.dispose();
	piProcess = undefined;
	await daemon?.dispose();
	daemon = undefined;
	if (stateDir) rmSync(stateDir, { recursive: true, force: true });
	stateDir = undefined;
});

async function startDaemon(): Promise<string> {
	stateDir = mkdtempSync(join(tmpdir(), "zodiacd-list-agentspace-"));
	daemon = spawnManagedProcess({ command: process.execPath, args: [serviceCli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir] });
	return waitForStdout(daemon, /listening on (http:\/\/\S+)/);
}

async function humanApply(daemonUrl: string, intent: Record<string, unknown>): Promise<{ surfaceId?: string }> {
	const response = await fetch(`${daemonUrl}/api/world/commands`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ intent }),
	});
	if (!response.ok) throw new Error(`humanApply(${String(intent["type"])}) rejected: ${response.status} ${await response.text()}`);
	const body = (await response.json()) as { result?: { surfaceId?: string } };
	return body.result ?? {};
}

const CALLABLE_INTEGRATION = { id: "callable", title: "Callable", capabilities: { renderable: true, hasApi: true } };
const RENDER_ONLY_INTEGRATION = { id: "render-only", title: "Render Only", capabilities: { renderable: true, hasApi: false } };

function spawnAgentSpaceQuery(daemonUrl: string): RealPiProcess {
	return spawnRealPiProcess({
		bin: resolvePiCliPath(),
		extensions: [resolveFauxProviderExtensionPath(), extensionPath],
		extraArgs: ["--provider", "faux", "--model", "faux-1"],
		env: {
			ZODIAC_AGENT_TOOL_DAEMON_URL: daemonUrl,
			ZODIAC_AGENT_TOOL_GRANT: JSON.stringify({ workspaceId: "ws-agentspace", allowedCommandTypes: [] }),
			ZODIAC_AGENT_TOOL_INTEGRATIONS: JSON.stringify([CALLABLE_INTEGRATION, RENDER_ONLY_INTEGRATION]),
			[SCRIPT_ENV_VAR]: encodeFauxScript([{ type: "toolCall", name: "list_agentspace", arguments: { workspaceId: "ws-agentspace" } }]),
		},
	});
}

async function queryAgentSpace(daemonUrl: string): Promise<unknown> {
	const process = spawnAgentSpaceQuery(daemonUrl);
	piProcess = process;
	const events: AgentSessionEvent[] = [];
	process.onEvent((event) => events.push(event));
	process.sendPrompt("go");
	const end = await waitForRpcEvent(events, (event) => event.type === "tool_execution_end", { timeoutMs: 20_000 });
	await process.dispose();
	piProcess = undefined;
	return end.type === "tool_execution_end" ? end.result : undefined;
}

describe("list_agentspace's own reported set changes live across a real surface.dock, driven through a real Pi process", () => {
	it("reports an empty AgentSpace before anything is docked, then the callable Integration (never the render-only one) once it's docked", async () => {
		const url = await startDaemon();
		await humanApply(url, { type: "workspace.create", workspaceId: "ws-agentspace", title: "AgentSpace Workspace" });

		const before = JSON.stringify(await queryAgentSpace(url));
		expect(before).not.toContain("callable");

		await humanApply(url, { type: "surface.dock", workspaceId: "ws-agentspace", integrationId: "callable", title: "Callable" });
		await humanApply(url, { type: "surface.dock", workspaceId: "ws-agentspace", integrationId: "render-only", title: "Render Only" });

		const after = JSON.stringify(await queryAgentSpace(url));
		expect(after).toContain("callable");
		expect(after).not.toContain("render-only");
	}, 40_000);
});
