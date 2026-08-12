import { describe, expect, it, vi } from "vitest";
import type { PiClient } from "./client.js";
import type { PiRpcEvent } from "@danypops/pi-rpc-protocol";
import { createPiChatController } from "./pi-chat-controller.js";

/** A fully in-memory PiClient stand-in -- mirrors usePiChat.test.ts's own fakeClient, since this controller is that hook's plain-object sibling. */
function fakeClient(): PiClient & { emit(event: PiRpcEvent): void } {
	let listener: ((event: PiRpcEvent) => void) | undefined;
	return {
		createSession: vi.fn(async () => "session-1"),
		sendPrompt: vi.fn(async () => {}),
		abort: vi.fn(async () => {}),
		streamEvents: vi.fn((_sessionId, onEvent) => {
			listener = onEvent;
			return () => {
				listener = undefined;
			};
		}),
		emit(event) {
			listener?.(event);
		},
	};
}

describe("createPiChatController", () => {
	it("echoes the user's message immediately and notifies subscribers", () => {
		const client = fakeClient();
		const controller = createPiChatController(client);
		const listener = vi.fn();
		controller.subscribe(listener);

		controller.sendMessage("hello");

		expect(controller.getSnapshot().items).toEqual([{ kind: "message", role: "user", text: "hello", timestamp: expect.any(Number) }]);
		expect(controller.getSnapshot().hasStarted).toBe(true);
		expect(listener).toHaveBeenCalled();
	});

	it("creates a session lazily on first send, passing through its own cwd option", async () => {
		const client = fakeClient();
		const controller = createPiChatController(client, { cwd: "/repos/lector" });
		expect(client.createSession).not.toHaveBeenCalled();

		controller.sendMessage("hi");
		await vi.waitFor(() => expect(client.createSession).toHaveBeenCalledWith({ cwd: "/repos/lector" }));
	});

	it("reuses the same session across multiple sends", async () => {
		const client = fakeClient();
		const controller = createPiChatController(client);
		controller.sendMessage("first");
		await vi.waitFor(() => expect(client.sendPrompt).toHaveBeenCalledTimes(1));
		controller.sendMessage("second");
		await vi.waitFor(() => expect(client.sendPrompt).toHaveBeenCalledTimes(2));
		expect(client.createSession).toHaveBeenCalledOnce();
	});

	it("tracks busy across agent_start/agent_settled", async () => {
		const client = fakeClient();
		const controller = createPiChatController(client);
		controller.sendMessage("hi");
		await vi.waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		client.emit({ type: "agent_start" });
		expect(controller.getSnapshot().busy).toBe(true);

		client.emit({ type: "agent_settled" });
		expect(controller.getSnapshot().busy).toBe(false);
	});

	it("live-updates a single assistant item across message_update deltas, then finalizes it on message_end", async () => {
		const client = fakeClient();
		const controller = createPiChatController(client);
		controller.sendMessage("hi");
		await vi.waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		client.emit({ type: "message_update", delta: { text: "Hel" } });
		expect(controller.getSnapshot().items).toHaveLength(2);
		expect(controller.getSnapshot().items[1]).toMatchObject({ kind: "message", role: "assistant", text: "Hel" });

		client.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello!" }] } });
		expect(controller.getSnapshot().items).toHaveLength(2);
		expect(controller.getSnapshot().items[1]).toMatchObject({ role: "assistant", text: "Hello!" });
	});

	it("pairs tool_execution_start/end into one tool-call item", async () => {
		const client = fakeClient();
		const controller = createPiChatController(client);
		controller.sendMessage("hi");
		await vi.waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		client.emit({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "ls" } });
		expect(controller.getSnapshot().items[1]).toMatchObject({ kind: "tool-call", toolCallId: "call_1", toolName: "bash", response: undefined });

		client.emit({ type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", result: { output: "ok" }, isError: false });
		expect(controller.getSnapshot().items[1]).toMatchObject({ kind: "tool-call", response: { output: "ok" } });
	});

	it("surfaces a rejected response as an error", async () => {
		const client = fakeClient();
		const controller = createPiChatController(client);
		controller.sendMessage("hi");
		await vi.waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		client.emit({ type: "response", command: "prompt", success: false, error: "no model configured" });
		expect(controller.getSnapshot().error).toBe("no model configured");
	});

	it("dispose() unsubscribes from the event stream and stops notifying listeners", async () => {
		const client = fakeClient();
		const controller = createPiChatController(client);
		const listener = vi.fn();
		controller.subscribe(listener);
		controller.sendMessage("hi");
		await vi.waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		controller.dispose();
		listener.mockClear();
		client.emit({ type: "agent_start" });
		expect(listener).not.toHaveBeenCalled();
	});
});
