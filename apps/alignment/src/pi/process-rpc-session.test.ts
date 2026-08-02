import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { spawnPiRpcSession, type PiRpcSession } from "./process-rpc-session.js";
import type { PiRpcEvent } from "./rpc-protocol.js";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/fake-pi-rpc.mjs", import.meta.url));

let session: PiRpcSession | undefined;

afterEach(() => {
	session?.dispose();
	session = undefined;
});

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
		session = spawnPiRpcSession({ command: ["node", FIXTURE] });
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
		session = spawnPiRpcSession({ command: ["node", FIXTURE] });
		const first = collectUntil(session, (event) => event.type === "agent_settled");
		const second = collectUntil(session, (event) => event.type === "agent_settled");
		session.sendPrompt("hi");
		const [a, b] = await Promise.all([first, second]);
		expect(a.length).toBe(b.length);
	});

	it("stops delivering events after an unsubscribe", async () => {
		session = spawnPiRpcSession({ command: ["node", FIXTURE] });
		const seen: PiRpcEvent["type"][] = [];
		const unsubscribe = session.onEvent((event) => seen.push(event.type));
		unsubscribe();
		const done = collectUntil(session, (event) => event.type === "agent_settled");
		session.sendPrompt("hi");
		await done;
		expect(seen).toEqual([]);
	});

	it("notifies onExit listeners when the process exits", async () => {
		session = spawnPiRpcSession({ command: ["node", FIXTURE] });
		const exit = new Promise<number | null>((resolve) => session?.onExit(resolve));
		session.dispose();
		await expect(exit).resolves.not.toBeUndefined();
	});

	it("does not throw when writing to an already-exited process", async () => {
		session = spawnPiRpcSession({ command: ["node", FIXTURE] });
		const exited = new Promise<void>((resolve) => session?.onExit(() => resolve()));
		session.dispose();
		await exited;
		expect(() => session?.sendPrompt("after exit")).not.toThrow();
	});
});
