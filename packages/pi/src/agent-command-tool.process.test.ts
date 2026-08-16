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
 * Story 7's own real proof: a real Pi process, given a scripted faux tool
 * call to zodiac_dispatch_command, and a human's own direct HTTP POST to
 * the identical daemon endpoint, produce identical WorldStore mutations --
 * and a call outside the agent's own grant is denied before it ever
 * reaches the daemon.
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
	stateDir = mkdtempSync(join(tmpdir(), "zodiacd-agent-command-tool-"));
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

interface WorldSnapshot {
	workspaces?: Array<{ id: string; windows: Array<{ surfaces: Array<{ integrationId: string; title: string }> }> }>;
}

async function fetchWorld(daemonUrl: string): Promise<WorldSnapshot> {
	const response = await fetch(`${daemonUrl}/api/world`);
	return (await response.json()) as WorldSnapshot;
}

const ACTIVITY_INTEGRATION = { id: "activity", title: "Activity", capabilities: { renderable: true, hasApi: true } };
const TERMINAL_NO_API_INTEGRATION = { id: "terminal", title: "Terminal", capabilities: { renderable: true, hasApi: false } };

function spawnAgent(options: { daemonUrl: string; grant: { workspaceId: string; allowedCommandTypes: string[] }; integrations: unknown[]; scriptArgs: Record<string, unknown> }): RealPiProcess {
	return spawnRealPiProcess({
		bin: resolvePiCliPath(),
		extensions: [resolveFauxProviderExtensionPath(), extensionPath],
		extraArgs: ["--provider", "faux", "--model", "faux-1"],
		env: {
			ZODIAC_AGENT_TOOL_DAEMON_URL: options.daemonUrl,
			ZODIAC_AGENT_TOOL_GRANT: JSON.stringify(options.grant),
			ZODIAC_AGENT_TOOL_INTEGRATIONS: JSON.stringify(options.integrations),
			[SCRIPT_ENV_VAR]: encodeFauxScript([{ type: "toolCall", name: "zodiac_dispatch_command", arguments: options.scriptArgs }]),
		},
	});
}

describe("Agent Integration tool: zodiac_dispatch_command against a real daemon and a real Pi process", () => {
	it("a real Pi tool call and a human's direct dispatch produce identical WorldStore Surface mutations", async () => {
		const url = await startDaemon();
		await humanApply(url, { type: "workspace.create", workspaceId: "ws-agent", title: "Agent Workspace" });
		await humanApply(url, { type: "workspace.create", workspaceId: "ws-human", title: "Human Workspace" });

		// The human path: apply the exact same surface.dock directly.
		await humanApply(url, { type: "surface.dock", workspaceId: "ws-human", integrationId: "activity", title: "Activity Board" });

		// The agent path: the identical surface.dock, but only reachable through
		// a real Pi tool call this session's own grant authorizes.
		piProcess = spawnAgent({
			daemonUrl: url,
			grant: { workspaceId: "ws-agent", allowedCommandTypes: ["surface.dock"] },
			integrations: [ACTIVITY_INTEGRATION],
			scriptArgs: { type: "surface.dock", workspaceId: "ws-agent", integrationId: "activity", title: "Activity Board" },
		});
		const events: AgentSessionEvent[] = [];
		piProcess.onEvent((event) => events.push(event));
		piProcess.sendPrompt("go");

		const end = await waitForRpcEvent(events, (event) => event.type === "tool_execution_end", { timeoutMs: 20_000 });
		expect(end.type).toBe("tool_execution_end");
		if (end.type === "tool_execution_end") expect(end.isError).toBe(false);

		const world = await fetchWorld(url);
		const agentSurface = world.workspaces?.find((workspace) => workspace.id === "ws-agent")?.windows[0]?.surfaces[0];
		const humanSurface = world.workspaces?.find((workspace) => workspace.id === "ws-human")?.windows[0]?.surfaces[0];
		expect(agentSurface).toBeDefined();
		// Same dispatcher, no caller-kind branch -- everything but `id` (a sequential
		// counter shared across the whole WorldStore, not a function of who called it)
		// must be byte-identical between the agent-driven dock and the human-driven one.
		expect({ ...agentSurface, id: undefined }).toEqual({ ...humanSurface, id: undefined });
	}, 30_000);

	it("round-trips a commandId supplied by the agent's own tool call in the response details", async () => {
		const url = await startDaemon();
		await humanApply(url, { type: "workspace.create", workspaceId: "ws-agent", title: "Agent Workspace" });

		piProcess = spawnAgent({
			daemonUrl: url,
			grant: { workspaceId: "ws-agent", allowedCommandTypes: ["surface.dock"] },
			integrations: [ACTIVITY_INTEGRATION],
			scriptArgs: { type: "surface.dock", workspaceId: "ws-agent", integrationId: "activity", title: "Activity Board", commandId: "agent-cmd-1" },
		});
		const events: AgentSessionEvent[] = [];
		piProcess.onEvent((event) => events.push(event));
		piProcess.sendPrompt("go");

		const end = await waitForRpcEvent(events, (event) => event.type === "tool_execution_end", { timeoutMs: 20_000 });
		expect(end.type).toBe("tool_execution_end");
		if (end.type === "tool_execution_end") {
			expect(end.isError).toBe(false);
			const resultText = JSON.stringify(end.result);
			expect(resultText).toContain("agent-cmd-1");
		}
	}, 30_000);

	it("denies a tool call whose target Integration does not declare hasApi, before it ever reaches the daemon", async () => {
		const url = await startDaemon();
		await humanApply(url, { type: "workspace.create", workspaceId: "ws-agent", title: "Agent Workspace" });

		piProcess = spawnAgent({
			daemonUrl: url,
			grant: { workspaceId: "ws-agent", allowedCommandTypes: ["surface.dock"] },
			integrations: [TERMINAL_NO_API_INTEGRATION],
			scriptArgs: { type: "surface.dock", workspaceId: "ws-agent", integrationId: "terminal", title: "Shell" },
		});
		const events: AgentSessionEvent[] = [];
		piProcess.onEvent((event) => events.push(event));
		piProcess.sendPrompt("go");

		const end = await waitForRpcEvent(events, (event) => event.type === "tool_execution_end", { timeoutMs: 20_000 });
		expect(end.type).toBe("tool_execution_end");
		if (end.type === "tool_execution_end") {
			expect(end.isError).toBe(true);
			expect(JSON.stringify(end.result)).toContain("integration-lacks-api");
		}

		const world = await fetchWorld(url);
		expect(world.workspaces?.find((workspace) => workspace.id === "ws-agent")?.windows[0]?.surfaces).toEqual([]);
	}, 30_000);
});
