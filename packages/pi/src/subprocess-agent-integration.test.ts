import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZodiacAgentEvent } from "@zodiac/agent";
import { createSubprocessAgentIntegration } from "./subprocess-agent-integration.js";

const FIXTURE = fileURLToPath(new URL("../test/fixtures/fake-pi-rpc.mjs", import.meta.url));
const ENV_PROBE_FIXTURE = fileURLToPath(new URL("../test/fixtures/env-probe-rpc.mjs", import.meta.url));

// A real, isolated agentDir/sourceAgentDir pair every test below passes
// explicitly -- without this, createSubprocessAgentIntegration's own default
// (resolveZodiacAgentDir() + the machine's real ~/.pi/agent) would run a
// real one-time auth.json copy against this developer machine's actual
// personal directory on every test run. The fixture commands here are plain
// `node` scripts, so PI_CODING_AGENT_DIR is inert either way -- these dirs
// exist purely to keep the seeding side effect hermetic.
let agentDirRoot: string | undefined;

function isolatedAgentDirs(): { agentDir: string; sourceAgentDir: string } {
	agentDirRoot = mkdtempSync(join(tmpdir(), "zodiac-subprocess-integration-"));
	return { agentDir: join(agentDirRoot, "zodiac-pi-agent"), sourceAgentDir: join(agentDirRoot, "personal-pi-agent") };
}

function collectUntil(port: ReturnType<typeof createSubprocessAgentIntegration>, predicate: (event: ZodiacAgentEvent) => boolean, timeoutMs = 5000): Promise<ZodiacAgentEvent[]> {
	return new Promise((resolve, reject) => {
		const events: ZodiacAgentEvent[] = [];
		const timer = setTimeout(() => reject(new Error(`timed out waiting for event; collected ${events.length}`)), timeoutMs);
		const unsubscribe = port.onEvent((event) => {
			events.push(event);
			if (predicate(event)) {
				clearTimeout(timer);
				unsubscribe();
				resolve(events);
			}
		});
	});
}

describe("createSubprocessAgentIntegration", () => {
	let integration: ReturnType<typeof createSubprocessAgentIntegration> | undefined;

	afterEach(() => {
		integration?.dispose();
		integration = undefined;
		if (agentDirRoot) rmSync(agentDirRoot, { recursive: true, force: true });
		agentDirRoot = undefined;
	});

	it("spawns a real child process and translates its PiRpcEvent stream into the same bounded event type the in-process adapter produces", async () => {
		integration = createSubprocessAgentIntegration({ command: ["node", FIXTURE], ...isolatedAgentDirs() });
		const done = collectUntil(integration, (event) => event.type === "agent-settled");
		await integration.prompt("hello fixture");
		const events = await done;

		expect(events.map((event) => event.type)).toEqual([
			"agent-start",
			"turn-start",
			"tool-call-start",
			"tool-call-update",
			"tool-call-end",
			"assistant-message-start",
			"assistant-message-delta",
			"assistant-message-delta",
			"assistant-message-end",
			"turn-end",
			"agent-settled",
		]);
		expect(events.find((event) => event.type === "tool-call-start")).toMatchObject({ toolName: "bash", input: { command: "echo hi" } });
		expect(events.find((event) => event.type === "assistant-message-end")).toMatchObject({ text: "fake reply" });
	});

	it("forwards model, compaction, resume, and fork controls over Pi's real RPC command vocabulary", async () => {
		integration = createSubprocessAgentIntegration({ command: ["node", FIXTURE], ...isolatedAgentDirs() });
		const names: string[] = [];
		integration.onEvent((event) => {
			if (event.type === "session-info-changed" && event.name) names.push(event.name);
		});

		await integration.session?.setModel("anthropic", "sonnet");
		await integration.session?.compact("focus");
		await integration.session?.resume("/tmp/session.jsonl");
		await integration.session?.fork("entry-1");

		await vi.waitFor(() => expect(names).toEqual(["set_model", "compact", "switch_session", "fork"]));
	});

	it("sends distinct steer and follow_up RPC commands instead of degrading both to prompt", async () => {
		integration = createSubprocessAgentIntegration({ command: ["node", FIXTURE], ...isolatedAgentDirs() });
		const names: string[] = [];
		integration.onEvent((event) => {
			if (event.type === "session-info-changed" && event.name) names.push(event.name);
		});
		await integration.steer("steered message");
		await integration.followUp("later");
		await vi.waitFor(() => expect(names).toEqual(["steer", "follow_up"]));
	});

	it("notifies onExit with a reason once the process exits abnormally", async () => {
		integration = createSubprocessAgentIntegration({ command: ["node", "-e", "process.exit(3)"], ...isolatedAgentDirs() });
		const exit = new Promise<string | undefined>((resolve) => integration?.onExit(resolve));
		await expect(exit).resolves.toMatch(/exited with code 3/);
	});

	it("onExit reports no reason for a clean exit", async () => {
		integration = createSubprocessAgentIntegration({ command: ["node", "-e", "process.exit(0)"], ...isolatedAgentDirs() });
		const exit = new Promise<string | undefined>((resolve) => integration?.onExit(resolve));
		await expect(exit).resolves.toBeUndefined();
	});

	it("does not throw when sending after the process has already exited", async () => {
		integration = createSubprocessAgentIntegration({ command: ["node", FIXTURE], ...isolatedAgentDirs() });
		const exited = new Promise<void>((resolve) => integration?.onExit(() => resolve()));
		integration.dispose();
		await exited;
		await expect(integration.prompt("after exit")).resolves.toBeUndefined();
	});

	describe("agent dir namespacing", () => {
		it("propagates agentDir to the spawned process as PI_CODING_AGENT_DIR, not the inherited default", async () => {
			const { agentDir, sourceAgentDir } = isolatedAgentDirs();
			integration = createSubprocessAgentIntegration({ command: ["node", ENV_PROBE_FIXTURE], agentDir, sourceAgentDir });
			const [event] = await collectUntil(integration, () => true);
			expect(event).toEqual({ type: "assistant-message-end", text: agentDir });
		});
	});
});
