import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { spawnPiRpcSession, type PiRpcSession } from "./process-rpc-session.js";
import type { PiRpcEvent } from "@danypops/pi-rpc-protocol";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/fake-pi-rpc.mjs", import.meta.url));
const ENV_PROBE_FIXTURE = fileURLToPath(new URL("../../test/fixtures/env-probe-rpc.mjs", import.meta.url));

let session: PiRpcSession | undefined;
// A real fixture directory pair every test in this file passes explicitly as
// agentDir/sourceAgentDir -- without this, spawnPiRpcSession's own default
// (resolveAlignmentAgentDir() + the machine's real ~/.pi/agent) would run a
// real one-time auth.json copy against this developer machine's actual
// personal Pi directory on every test run. The fixture command here is a
// plain `node` script, not `pi`, so PI_CODING_AGENT_DIR is inert either way
// -- these dirs exist purely to keep the seeding side effect hermetic.
let agentDirRoot: string | undefined;

afterEach(() => {
	session?.dispose();
	session = undefined;
	if (agentDirRoot) rmSync(agentDirRoot, { recursive: true, force: true });
	agentDirRoot = undefined;
});

function isolatedAgentDirs(): { agentDir: string; sourceAgentDir: string } {
	agentDirRoot = mkdtempSync(join(tmpdir(), "alignment-rpc-session-"));
	return { agentDir: join(agentDirRoot, "alignment-pi-agent"), sourceAgentDir: join(agentDirRoot, "personal-pi-agent") };
}

function collectUntil(target: PiRpcSession, predicate: (event: PiRpcEvent) => boolean, timeoutMs = 5000): Promise<PiRpcEvent[]> {
	return new Promise((resolve, reject) => {
		const events: PiRpcEvent[] = [];
		const timer = setTimeout(() => reject(new Error(`timed out waiting for event; collected ${events.length}`)), timeoutMs);
		const unsubscribe = target.onEvent((event) => {
			events.push(event);
			if (predicate(event)) {
				clearTimeout(timer);
				unsubscribe();
				resolve(events);
			}
		});
	});
}

describe("spawnPiRpcSession", () => {
	it("spawns a real child process, sends a prompt, and parses the resulting event stream in order", async () => {
		session = spawnPiRpcSession({ command: ["node", FIXTURE], ...isolatedAgentDirs() });
		const done = collectUntil(session, (event) => event.type === "agent_settled");
		session.sendPrompt("hello fixture");
		const events = await done;

		expect(events.map((event) => event.type)).toEqual([
			"response",
			"message_start",
			"message_end",
			"agent_start",
			"tool_execution_start",
			"tool_execution_end",
			"message_start",
			"message_update",
			"message_update",
			"message_end",
			"agent_end",
			"agent_settled",
		]);

		const promptResponse = events[0];
		expect(promptResponse).toEqual({ type: "response", command: "prompt", success: true, error: undefined });

		const toolStart = events[4];
		expect(toolStart).toEqual({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "echo hi" } });

		const lastUpdate = events[8];
		expect(lastUpdate).toEqual({ type: "message_update", delta: { text: "fake reply" } });
	});

	it("delivers each event to every subscribed listener", async () => {
		session = spawnPiRpcSession({ command: ["node", FIXTURE], ...isolatedAgentDirs() });
		const first = collectUntil(session, (event) => event.type === "agent_settled");
		const second = collectUntil(session, (event) => event.type === "agent_settled");
		session.sendPrompt("hi");
		const [a, b] = await Promise.all([first, second]);
		expect(a.length).toBe(b.length);
	});

	it("stops delivering events after an unsubscribe", async () => {
		session = spawnPiRpcSession({ command: ["node", FIXTURE], ...isolatedAgentDirs() });
		const seen: PiRpcEvent["type"][] = [];
		const unsubscribe = session.onEvent((event) => seen.push(event.type));
		unsubscribe();
		const done = collectUntil(session, (event) => event.type === "agent_settled");
		session.sendPrompt("hi");
		await done;
		expect(seen).toEqual([]);
	});

	it("notifies onExit listeners when the process exits", async () => {
		session = spawnPiRpcSession({ command: ["node", FIXTURE], ...isolatedAgentDirs() });
		const exit = new Promise<number | null>((resolve) => session?.onExit(resolve));
		session.dispose();
		await expect(exit).resolves.not.toBeUndefined();
	});

	it("does not throw when writing to an already-exited process", async () => {
		session = spawnPiRpcSession({ command: ["node", FIXTURE], ...isolatedAgentDirs() });
		const exited = new Promise<void>((resolve) => session?.onExit(() => resolve()));
		session.dispose();
		await exited;
		expect(() => session?.sendPrompt("after exit")).not.toThrow();
	});

	describe("agent dir namespacing", () => {
		it("propagates agentDir to the spawned process as PI_CODING_AGENT_DIR, not the inherited default", async () => {
			const { agentDir, sourceAgentDir } = isolatedAgentDirs();
			session = spawnPiRpcSession({ command: ["node", ENV_PROBE_FIXTURE], agentDir, sourceAgentDir });
			const [event] = await collectUntil(session, () => true);
			expect(event).toEqual({ type: "response", command: "env-probe", success: true, error: agentDir });
		});

		it("seeds agentDir/auth.json from sourceAgentDir on first spawn", async () => {
			const { agentDir, sourceAgentDir } = isolatedAgentDirs();
			mkdirSync(sourceAgentDir, { recursive: true });
			writeFileSync(join(sourceAgentDir, "auth.json"), JSON.stringify({ anthropic: { apiKey: "personal-real-key" } }));

			session = spawnPiRpcSession({ command: ["node", FIXTURE], agentDir, sourceAgentDir });

			expect(existsSync(join(agentDir, "auth.json"))).toBe(true);
			expect(readFileSync(join(agentDir, "auth.json"), "utf-8")).toBe(JSON.stringify({ anthropic: { apiKey: "personal-real-key" } }));
		});

		it("never overwrites an already-existing agentDir/auth.json", async () => {
			const { agentDir, sourceAgentDir } = isolatedAgentDirs();
			mkdirSync(sourceAgentDir, { recursive: true });
			mkdirSync(agentDir, { recursive: true });
			writeFileSync(join(sourceAgentDir, "auth.json"), JSON.stringify({ anthropic: { apiKey: "personal-key" } }));
			writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ anthropic: { apiKey: "alignment-own-key" } }));

			session = spawnPiRpcSession({ command: ["node", FIXTURE], agentDir, sourceAgentDir });

			expect(readFileSync(join(agentDir, "auth.json"), "utf-8")).toBe(JSON.stringify({ anthropic: { apiKey: "alignment-own-key" } }));
		});
	});
});
