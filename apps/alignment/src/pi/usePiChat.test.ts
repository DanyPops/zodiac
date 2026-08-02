/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PiClient } from "./client.js";
import type { PiRpcEvent } from "@danypops/pi-rpc-protocol";
import { usePiChat } from "./usePiChat.js";

/** A fully in-memory PiClient stand-in -- tests drive the session by calling the returned `emit` helper directly instead of a real network/SSE connection. */
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

describe("usePiChat", () => {
	it("echoes the user's message immediately, before the session round-trip resolves", () => {
		const client = fakeClient();
		const { result } = renderHook(() => usePiChat(client));

		act(() => result.current.sendMessage("hello"));

		expect(result.current.items).toEqual([{ kind: "message", role: "user", text: "hello", timestamp: expect.any(Number) }]);
		expect(result.current.hasStarted).toBe(true);
	});

	it("creates a session lazily on first send, not on mount", () => {
		const client = fakeClient();
		renderHook(() => usePiChat(client));
		expect(client.createSession).not.toHaveBeenCalled();
	});

	it("sends the trimmed message to the created session", async () => {
		const client = fakeClient();
		const { result } = renderHook(() => usePiChat(client));

		act(() => result.current.sendMessage("  hello  "));

		await waitFor(() => expect(client.sendPrompt).toHaveBeenCalledWith("session-1", "hello"));
	});

	it("ignores an empty or whitespace-only message", () => {
		const client = fakeClient();
		const { result } = renderHook(() => usePiChat(client));
		act(() => result.current.sendMessage("   "));
		expect(result.current.items).toEqual([]);
		expect(result.current.hasStarted).toBe(false);
	});

	it("reuses the same session across multiple sends", async () => {
		const client = fakeClient();
		const { result } = renderHook(() => usePiChat(client));
		act(() => result.current.sendMessage("first"));
		await waitFor(() => expect(client.sendPrompt).toHaveBeenCalledTimes(1));
		act(() => result.current.sendMessage("second"));
		await waitFor(() => expect(client.sendPrompt).toHaveBeenCalledTimes(2));
		expect(client.createSession).toHaveBeenCalledOnce();
	});

	it("tracks busy across agent_start/agent_settled", async () => {
		const client = fakeClient();
		const { result } = renderHook(() => usePiChat(client));
		act(() => result.current.sendMessage("hi"));
		await waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		act(() => client.emit({ type: "agent_start" }));
		expect(result.current.busy).toBe(true);

		act(() => client.emit({ type: "agent_settled" }));
		expect(result.current.busy).toBe(false);
	});

	it("suppresses the server-echoed user message_start/message_end", async () => {
		const client = fakeClient();
		const { result } = renderHook(() => usePiChat(client));
		act(() => result.current.sendMessage("hi"));
		await waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		act(() => client.emit({ type: "message_start", message: { role: "user", content: "hi" } }));
		act(() => client.emit({ type: "message_end", message: { role: "user", content: "hi" } }));

		expect(result.current.items).toHaveLength(1);
	});

	it("live-updates a single assistant item across message_update deltas, then finalizes it on message_end", async () => {
		const client = fakeClient();
		const { result } = renderHook(() => usePiChat(client));
		act(() => result.current.sendMessage("hi"));
		await waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		act(() => client.emit({ type: "message_update", delta: { text: "Hel" } }));
		expect(result.current.items).toHaveLength(2);
		expect(result.current.items[1]).toMatchObject({ kind: "message", role: "assistant", text: "Hel" });

		act(() => client.emit({ type: "message_update", delta: { text: "Hello" } }));
		expect(result.current.items).toHaveLength(2);
		expect(result.current.items[1]).toMatchObject({ role: "assistant", text: "Hello" });

		act(() => client.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello!" }] } }));
		expect(result.current.items).toHaveLength(2);
		expect(result.current.items[1]).toMatchObject({ role: "assistant", text: "Hello!" });

		// A brand-new assistant turn after agent_settled starts a fresh item, not another in-place replace of the finalized one.
		act(() => client.emit({ type: "agent_settled" }));
		act(() => client.emit({ type: "message_update", delta: { text: "Again" } }));
		expect(result.current.items).toHaveLength(3);
	});

	it("pairs tool_execution_start/end into one tool-call item", async () => {
		const client = fakeClient();
		const { result } = renderHook(() => usePiChat(client));
		act(() => result.current.sendMessage("hi"));
		await waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		act(() => client.emit({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "ls" } }));
		expect(result.current.items[1]).toMatchObject({ kind: "tool-call", toolCallId: "call_1", toolName: "bash", request: { command: "ls" }, response: undefined });

		act(() => client.emit({ type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", result: { output: "ok" }, isError: false }));
		expect(result.current.items[1]).toMatchObject({ kind: "tool-call", response: { output: "ok" } });
		expect(result.current.items).toHaveLength(2);
	});

	it("surfaces a rejected response as an error", async () => {
		const client = fakeClient();
		const { result } = renderHook(() => usePiChat(client));
		act(() => result.current.sendMessage("hi"));
		await waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		act(() => client.emit({ type: "response", command: "prompt", success: false, error: "no model configured" }));
		expect(result.current.error).toBe("no model configured");
	});

	it("surfaces a session-creation failure as a human-readable error", async () => {
		const client = fakeClient();
		(client.createSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("spawn failed"));
		const { result } = renderHook(() => usePiChat(client));
		act(() => result.current.sendMessage("hi"));
		await waitFor(() => expect(result.current.error).toMatch(/spawn failed/));
	});
});
