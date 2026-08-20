import { describe, expect, it, vi } from "vitest";
import type { PiClient } from "./client.js";
import type { ZodiacAgentEvent } from "@zodiac/agent";
import { createPiChatController } from "./pi-chat-controller.js";

/** A fully in-memory PiClient stand-in, driven by zodiacd's own bounded ZodiacAgentEvent vocabulary. */
function fakeClient(): PiClient & { emit(event: ZodiacAgentEvent): void } {
	let listener: ((event: ZodiacAgentEvent) => void) | undefined;
	return {
		createSession: vi.fn(async () => "session-1"),
		sendPrompt: vi.fn(async () => {}),
		abort: vi.fn(async () => {}),
		postClientAction: vi.fn(async () => {}),
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

	it("tracks busy across agent-start/agent-settled", async () => {
		const client = fakeClient();
		const controller = createPiChatController(client);
		controller.sendMessage("hi");
		await vi.waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		client.emit({ type: "agent-start" });
		expect(controller.getSnapshot().busy).toBe(true);

		client.emit({ type: "agent-settled" });
		expect(controller.getSnapshot().busy).toBe(false);
	});

	it("live-updates a single assistant item across assistant-message-delta events, then finalizes it on assistant-message-end", async () => {
		const client = fakeClient();
		const controller = createPiChatController(client);
		controller.sendMessage("hi");
		await vi.waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		client.emit({ type: "assistant-message-start" });
		client.emit({ type: "assistant-message-delta", text: "Hel" });
		expect(controller.getSnapshot().items).toHaveLength(2);
		expect(controller.getSnapshot().items[1]).toMatchObject({ kind: "message", role: "assistant", text: "Hel" });

		client.emit({ type: "assistant-message-end", text: "Hello!" });
		expect(controller.getSnapshot().items).toHaveLength(2);
		expect(controller.getSnapshot().items[1]).toMatchObject({ role: "assistant", text: "Hello!" });
	});

	it("pairs tool-call-start/end into one tool-call item", async () => {
		const client = fakeClient();
		const controller = createPiChatController(client);
		controller.sendMessage("hi");
		await vi.waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		client.emit({ type: "tool-call-start", toolCallId: "call_1", toolName: "bash", input: { command: "ls" } });
		expect(controller.getSnapshot().items[1]).toMatchObject({ kind: "tool-call", toolCallId: "call_1", toolName: "bash", response: undefined });

		client.emit({ type: "tool-call-end", toolCallId: "call_1", toolName: "bash", output: { output: "ok" }, isError: false });
		expect(controller.getSnapshot().items[1]).toMatchObject({ kind: "tool-call", response: { output: "ok" } });
	});

	it("calls onToolCall with the real sessionId for every tool-call-start event -- generic, never inspects toolName itself", async () => {
		const client = fakeClient();
		const onToolCall = vi.fn();
		const controller = createPiChatController(client, { onToolCall });
		controller.sendMessage("hi");
		await vi.waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		client.emit({ type: "tool-call-start", toolCallId: "call_1", toolName: "list_visual_cues", input: {} });

		expect(onToolCall).toHaveBeenCalledWith({ sessionId: "session-1", toolCallId: "call_1", toolName: "list_visual_cues", input: {} });
	});

	it("surfaces an error event, clearing busy", async () => {
		const client = fakeClient();
		const controller = createPiChatController(client);
		controller.sendMessage("hi");
		await vi.waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		client.emit({ type: "agent-start" });
		client.emit({ type: "error", message: "no model configured" });
		expect(controller.getSnapshot().error).toBe("no model configured");
		expect(controller.getSnapshot().busy).toBe(false);
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
		client.emit({ type: "agent-start" });
		expect(listener).not.toHaveBeenCalled();
	});
});
