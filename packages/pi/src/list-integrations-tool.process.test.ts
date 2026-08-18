import { execFileSync, spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { encodeFauxScript, resolveFauxProviderExtensionPath, resolvePiCliPath, SCRIPT_ENV_VAR, spawnRealPiProcess, waitForRpcEvent, type RealPiProcess } from "@danypops/pi-process-harness";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "../..");
const serviceCli = resolve(workspaceRoot, "apps/service/dist/cli.js");
const extensionPath = resolve(packageRoot, "src/fixtures/agent-command-extension.ts");

type ZodiacdProcess = ChildProcessByStdio<null, Readable, Readable>;

/**
 * Test 5 of dbed439e's own plan: a real Pi process, scripted so a request
 * implying a missing capability leads it to call list_integrations, proven
 * against a real spawned daemon -- reuses agent-command-tool.process.test.ts's
 * own fixture extension (it already registers both tools) and spawn helpers.
 */
async function waitForZodiacdReady(child: ZodiacdProcess): Promise<string> {
	return new Promise((resolveReady, reject) => {
		let stdout = "";
		let stderr = "";
		const onData = (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
			const match = /listening on (http:\/\/\S+)/.exec(stdout);
			const url = match?.[1];
			if (url) {
				child.stdout.off("data", onData);
				resolveReady(url);
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

let daemon: ZodiacdProcess | undefined;
let stateDir: string | undefined;
let piProcess: RealPiProcess | undefined;

beforeAll(() => {
	execFileSync("npm", ["run", "build", "--workspace=@zodiac/service"], { cwd: workspaceRoot, stdio: "inherit" });
}, 60_000);

afterEach(async () => {
	await piProcess?.dispose();
	piProcess = undefined;
	if (daemon && !daemon.killed) {
		daemon.kill("SIGTERM");
		await new Promise<void>((resolveExit) => {
			daemon?.once("exit", () => resolveExit());
			setTimeout(resolveExit, 2_000);
		});
	}
	daemon = undefined;
	if (stateDir) rmSync(stateDir, { recursive: true, force: true });
	stateDir = undefined;
});

async function startDaemon(): Promise<string> {
	stateDir = mkdtempSync(join(tmpdir(), "zodiacd-list-integrations-tool-"));
	daemon = spawn(process.execPath, [serviceCli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir], { stdio: ["ignore", "pipe", "pipe"] });
	return waitForZodiacdReady(daemon);
}

async function humanApply(daemonUrl: string, intent: Record<string, unknown>): Promise<void> {
	const response = await fetch(`${daemonUrl}/api/world/commands`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ intent }),
	});
	if (!response.ok) throw new Error(`humanApply(${String(intent["type"])}) rejected: ${response.status} ${await response.text()}`);
}

const LECTOR_INTEGRATION = { id: "lector", title: "Lector", capabilities: { renderable: true, hasApi: true } };
const ACTIVITY_INTEGRATION = { id: "activity", title: "Activity", capabilities: { renderable: true, hasApi: true } };

function spawnAgent(options: { daemonUrl: string; integrations: unknown[]; scriptArgs: Record<string, unknown> }): RealPiProcess {
	return spawnRealPiProcess({
		bin: resolvePiCliPath(),
		extensions: [resolveFauxProviderExtensionPath(), extensionPath],
		extraArgs: ["--provider", "faux", "--model", "faux-1"],
		env: {
			ZODIAC_AGENT_TOOL_DAEMON_URL: options.daemonUrl,
			ZODIAC_AGENT_TOOL_GRANT: JSON.stringify({ workspaceId: "ws-agent", allowedCommandTypes: [] }),
			ZODIAC_AGENT_TOOL_INTEGRATIONS: JSON.stringify(options.integrations),
			[SCRIPT_ENV_VAR]: encodeFauxScript([{ type: "toolCall", name: "list_integrations", arguments: options.scriptArgs }]),
		},
	});
}

describe("Agent Integration tool: list_integrations against a real daemon and a real Pi process", () => {
	it("a real Pi tool call reports the real docked/undocked split for a real Workspace, and the fauxProvider's own generated reply text is never inspected by this test", async () => {
		const url = await startDaemon();
		await humanApply(url, { type: "workspace.create", workspaceId: "ws-agent", title: "Agent Workspace" });
		await humanApply(url, { type: "surface.dock", workspaceId: "ws-agent", integrationId: "activity", title: "Activity Board" });

		piProcess = spawnAgent({
			daemonUrl: url,
			integrations: [ACTIVITY_INTEGRATION, LECTOR_INTEGRATION],
			scriptArgs: { workspaceId: "ws-agent" },
		});
		const events: AgentSessionEvent[] = [];
		piProcess.onEvent((event) => events.push(event));
		piProcess.sendPrompt("go");

		const end = await waitForRpcEvent(events, (event) => event.type === "tool_execution_end", { timeoutMs: 20_000 });
		expect(end.type).toBe("tool_execution_end");
		if (end.type !== "tool_execution_end") return;
		expect(end.isError).toBe(false);
		const resultText = JSON.stringify(end.result);
		expect(resultText).toContain("activity");
		expect(resultText).toContain("lector");
	}, 30_000);

	it("never issues a surface.dock -- purely read-only, even though it can see an undocked Integration exists", async () => {
		const url = await startDaemon();
		await humanApply(url, { type: "workspace.create", workspaceId: "ws-agent", title: "Agent Workspace" });

		piProcess = spawnAgent({ daemonUrl: url, integrations: [LECTOR_INTEGRATION], scriptArgs: { workspaceId: "ws-agent" } });
		const events: AgentSessionEvent[] = [];
		piProcess.onEvent((event) => events.push(event));
		piProcess.sendPrompt("go");
		await waitForRpcEvent(events, (event) => event.type === "tool_execution_end", { timeoutMs: 20_000 });

		const world = (await (await fetch(`${url}/api/world`)).json()) as { workspaces?: Array<{ id: string; windows: Array<{ surfaces: unknown[] }> }> };
		expect(world.workspaces?.find((workspace) => workspace.id === "ws-agent")?.windows[0]?.surfaces).toEqual([]);
	}, 30_000);
});
