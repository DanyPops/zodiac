/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PiClient } from "./client.js";
import type { ZodiacAgentEvent } from "@zodiac/agent";
import { usePiChatSessions } from "./usePiChatSessions.js";

/** A PiClient stand-in that hands out a distinct fake session per createSession() call and remembers each one's own event listener separately -- the point being to prove sessions stay independent. */
function fakeMultiSessionClient(): PiClient & { emit(sessionId: string, event: ZodiacAgentEvent): void } {
	let nextId = 1;
	const listeners = new Map<string, (event: ZodiacAgentEvent) => void>();
	const cwdBySession = new Map<string, string | undefined>();
	return {
		createSession: vi.fn(async (options) => {
			const sessionId = `session-${nextId++}`;
			cwdBySession.set(sessionId, options?.cwd);
			return sessionId;
		}),
		sendPrompt: vi.fn(async () => {}),
		abort: vi.fn(async () => {}),
		streamEvents: vi.fn((sessionId, onEvent) => {
			listeners.set(sessionId, onEvent);
			return () => listeners.delete(sessionId);
		}),
		emit(sessionId, event) {
			listeners.get(sessionId)?.(event);
		},
	};
}

describe("usePiChatSessions", () => {
	it("gives two different keys two independent sessions with independent state", async () => {
		const client = fakeMultiSessionClient();
		const { result } = renderHook(() => usePiChatSessions(client));

		act(() => result.current.chatFor("workspace-a").sendMessage("hello from A"));
		act(() => result.current.chatFor("workspace-b").sendMessage("hello from B"));

		await waitFor(() => expect(client.createSession).toHaveBeenCalledTimes(2));

		expect(result.current.chatFor("workspace-a").items).toEqual([{ kind: "message", role: "user", text: "hello from A", timestamp: expect.any(Number) }]);
		expect(result.current.chatFor("workspace-b").items).toEqual([{ kind: "message", role: "user", text: "hello from B", timestamp: expect.any(Number) }]);
	});

	it("an event on one key's session never affects another key's state", async () => {
		const client = fakeMultiSessionClient();
		const { result } = renderHook(() => usePiChatSessions(client));

		act(() => result.current.chatFor("workspace-a").sendMessage("hi"));
		act(() => result.current.chatFor("workspace-b").sendMessage("hi"));
		await waitFor(() => expect(client.streamEvents).toHaveBeenCalledTimes(2));

		act(() => client.emit("session-1", { type: "agent-start" }));

		expect(result.current.chatFor("workspace-a").busy).toBe(true);
		expect(result.current.chatFor("workspace-b").busy).toBe(false);
	});

	it("reuses the same session for the same key across renders instead of creating a new one", async () => {
		const client = fakeMultiSessionClient();
		const { result } = renderHook(() => usePiChatSessions(client));

		act(() => result.current.chatFor("workspace-a").sendMessage("first"));
		await waitFor(() => expect(client.createSession).toHaveBeenCalledTimes(1));

		act(() => result.current.chatFor("workspace-a").sendMessage("second"));
		await waitFor(() => expect(client.sendPrompt).toHaveBeenCalledTimes(2));
		expect(client.createSession).toHaveBeenCalledTimes(1);
	});

	it("passes a key's own cwd option through only on its first creation", async () => {
		const client = fakeMultiSessionClient();
		const { result } = renderHook(() => usePiChatSessions(client));

		act(() => result.current.chatFor("workspace-a", { cwd: "/repos/tickets" }).sendMessage("hi"));
		await waitFor(() => expect(client.createSession).toHaveBeenCalledWith({ cwd: "/repos/tickets" }));
	});

	it("disposeSession ends one key's session without disturbing another key's", async () => {
		const client = fakeMultiSessionClient();
		const { result } = renderHook(() => usePiChatSessions(client));

		act(() => result.current.chatFor("workspace-a").sendMessage("hi"));
		act(() => result.current.chatFor("workspace-b").sendMessage("hi"));
		await waitFor(() => expect(client.streamEvents).toHaveBeenCalledTimes(2));

		act(() => result.current.disposeSession("workspace-a"));

		// workspace-a's key is now fresh -- accessing it again starts a brand
		// new session rather than resurrecting the disposed one.
		act(() => result.current.chatFor("workspace-a").sendMessage("again"));
		await waitFor(() => expect(client.createSession).toHaveBeenCalledTimes(3));

		// workspace-b was never touched by disposing workspace-a.
		expect(result.current.chatFor("workspace-b").items).toHaveLength(1);
	});
});
